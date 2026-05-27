import { $, node, observe, act, feedback } from './dashboard.mjs';
import { markerMeasurement } from './shared/markers.mjs';
import {
  Calibration,
  DriftGate,
  calibrated,
  drifting,
  geometry,
  labels,
  samplingRate,
} from './shared/kinematics.mjs';

let state,
  device = null,
  model = null,
  generation = 0,
  running = false,
  timeout;
let cameraRate, lastMarkerVisible = false;
const markerCanvas = document.createElement('canvas');
const markerPixels = markerCanvas.getContext('2d', { willReadFrequently: true });
function readMarkers(pose) {
  const width = Math.min(480, video.videoWidth);
  const height = Math.round(width * video.videoHeight / video.videoWidth);
  if (markerCanvas.width !== width || markerCanvas.height !== height) {
    markerCanvas.width = width;
    markerCanvas.height = height;
  }
  markerPixels.drawImage(video, 0, 0, width, height);
  try {
    return markerMeasurement(markerPixels.getImageData(0, 0, width, height), pose);
  } finally {
    markerPixels.clearRect(0, 0, width, height);
  }
}
let calibration,
  gate,
  lastSecond,
  lastVideoTime,
  lastFrameAt,
  lastValid,
  verify,
  pendingCue,
  prediction = null;
let classifier = null;
export function setClassifier(value) {
  classifier = value;
  classifier?.reset();
  prediction = null;
  gate = new DriftGate();
  pendingCue = false;
}
const video = $('video');
const titles = ['Neutral', 'Sustained slouch', 'Writing', 'Brief reading', 'Reaching / shifting'];
const message = (text) => {
  if ($('sensor-message').textContent !== text) $('sensor-message').textContent = text;
};
function framing() {
  $('marker-option').hidden = $('view').value !== 'side';
  $('marker-help').hidden = $('view').value !== 'side' || !$('markers').checked;
  $('framing').textContent =
    $('view').value === 'side'
      ? 'Level the camera beside you. Keep the near ear, shoulder and hip in frame. Hold still for 10 seconds.'
      : 'Face a level camera with both shoulders and hips visible. Hold still for 10 seconds.';
}
function reset() {
  calibration = new Calibration();
  gate = new DriftGate();
  classifier?.reset();
  prediction = null;
  verify = false;
  pendingCue = false;
  lastSecond = null;
  lastVideoTime = -1;
  lastFrameAt = -Infinity;
  lastValid = false;
  lastMarkerVisible = false;
  $('readings').replaceChildren();
}
function buttons() {
  $('camera-button').textContent = running ? 'Stop camera' : 'Start camera';
  $('camera-button').disabled = !state?.session;
  $('view').disabled = running;
  $('recalibrate').disabled = !running || !model;
  $('capture').checked = state?.collecting || false;
  $('capture').disabled = !running || !calibration?.reference || $('view').value !== 'side';
  $('labels')
    .querySelectorAll('button')
    .forEach((b, i) => {
      b.disabled = !state?.collecting;
      b.setAttribute('aria-pressed', String(state?.label === labels[i]));
    });
  $('shortcut-info').textContent = state?.collecting
    ? state.shortcutsReady
      ? 'Press Ctrl + Alt + 1–5 from any window.'
      : 'Use these buttons or the 1–5 keys in this window.'
    : 'Capture is off.';
}
function stop(status, inform = true) {
  generation++;
  clearTimeout(timeout);
  running = false;
  if (device)
    for (const track of device.getTracks()) {
      track.onended = null;
      track.stop();
    }
  video.pause();
  video.srcObject = null;
  device = null;
  cameraRate = null;
  model?.close();
  model = null;
  $('preview').hidden = true;
  reset();
  buttons();
  message(status);
  if (inform && state?.session) void act('sensorOff');
}
function readings(m) {
  const metrics =
    m.view === 'front'
      ? [['Shoulder elevation', m.asym, '°']]
      : [
          ['CVA proxy', m.cva, '°'],
          ...(m.marker ? [['Tragus–C7 CVA', m.marker.cva, '°'], ['Shoulder ahead of C7', m.marker.shoulder, ' torso']] : []),
          ['CVA drop', m.drop, '°'],
          ['Protraction proxy', m.shoulder, ' torso'],
          ['Moment proxy', m.moment, ' N·m'],
          ['Lever load', m.load, ' lbf'],
        ];
  $('readings').replaceChildren(
    ...metrics.map(([label, value, unit]) => {
      const d = node('div', undefined, 'reading');
      d.append(node('span', label), node('strong', value.toFixed(unit === ' torso' ? 2 : 1) + unit));
      return d;
    }),
  );
}
async function noTracking(now) {
  gate.update(null, now);
  classifier?.reset();
  prediction = null;
  verify = false;
  pendingCue = false;
  if (lastValid) {
    lastValid = false;
    $('readings').replaceChildren();
    await act('lost');
  }
}
async function loop(token) {
  if (!running || token !== generation) return;
  const started = performance.now();
  const rate = samplingRate({
    idle: false,
    calibrated: Boolean(calibration.reference),
    verify,
    fixed: false,
  });
  try {
    const track = device.getVideoTracks()[0];
    if (!rate || !video.videoWidth || video.readyState < 2 || video.currentTime === lastVideoTime) {
      if (!rate || started - lastFrameAt > 1800) {
        if (!calibration.reference) calibration.samples = [];
        await noTracking(started);
        message(rate ? 'Waiting for a fresh camera frame…' : 'Paused while the computer is idle · 0 FPS');
      }
    } else {
      lastVideoTime = video.currentTime;
      lastFrameAt = started;
      const points = model.detectForVideo(video, started).landmarks[0];
      const g = geometry(
        points,
        video.videoWidth,
        video.videoHeight,
        $('view').value,
        calibration.reference || calibration.samples[0],
      );
      if (!calibration.reference) {
        const progress = calibration.update(g, started);
        message(
          g
            ? 'Hold comfortably · ' + Math.min(10, Math.floor(progress * 10)) + ' / 10 seconds'
            : 'Adjust the camera until the required landmarks are visible.',
        );
        if (calibration.reference) buttons();
      } else {
        const m = calibrated(g, calibration.reference);
        if (!m) {
          await noTracking(started);
          message('Tracking paused. Return to the calibrated view or recalibrate.');
        } else {
          lastValid = true;
          verify = drifting(m);
          if (!classifier || m.view === 'front') {
            const cue = gate.update(verify, started);
            pendingCue = verify && (pendingCue || cue);
          }
          const second = Math.floor(Date.now() / 1000);
          if (second !== lastSecond) {
            if (m.view === 'side' && $('markers').checked) m.marker = readMarkers(g);
            lastMarkerVisible = Boolean(m.marker);
            const activeClassifier = classifier;
            const scored =
              m.vector && activeClassifier ? await activeClassifier.push(second, m.vector) : null;
            if (token !== generation) return;
            const result = activeClassifier === classifier ? scored : null;
            prediction = result?.label ?? null;
            if (m.vector && classifier) {
              const classified = prediction === null ? null : prediction === 'slouch';
              pendingCue ||= gate.update(classified, started);
            }
            readings(m);
            await window.desk.sample({
              session: state.session.id,
              metrics: m,
              rate,
              fixed: false,
              cue: pendingCue,
              prediction,
                          });
            if (token !== generation) return;
            pendingCue = false;
            lastSecond = second;
          }
          message(
            (rate === 1 ? 'Monitoring' : 'Verifying alignment') +
              ' · ' +
              rate +
              ' FPS' +
              (track.getSettings?.().frameRate ? ' · camera ' + Math.round(track.getSettings().frameRate) + ' FPS' : '') +
              (m.view === 'side' && $('markers').checked && !lastMarkerVisible ? ' · markers not located' : '') +
              (prediction ? ' · ' + titles[labels.indexOf(prediction)] : ''),
          );
        }
      }
    }
  } catch (err) {
    if (token === generation) stop('Tracking stopped. ' + err.message);
    return;
  }
  if (token === generation)
    timeout = setTimeout(
      () => loop(token),
      Math.max(1, (rate ? 1000 / rate : 500) - (performance.now() - started)),
    );
}
async function start() {
  running = true;
  const token = ++generation;
  reset();
  buttons();
  message('Opening the local camera…');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: false ? 30 : 12, max: 30 } },
    });
    if (token !== generation) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    device = stream;
    device.getVideoTracks()[0].onended = () =>
      stop('Camera disconnected. You can continue the study session.');
    video.srcObject = stream;
    $('preview').hidden = false;
    await video.play();
    if (token !== generation) return;
    message('Loading the offline pose sensor…');
    const { FilesetResolver, PoseLandmarker } = await import('./vendor/vision.mjs');
    const files = await FilesetResolver.forVisionTasks(new URL('./vendor/vision', import.meta.url).href);
    const task = await PoseLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: new URL('./assets/pose.task', import.meta.url).href, delegate: 'CPU' },
      runningMode: 'VIDEO',
      numPoses: 1,
    });
    if (token !== generation) {
      task.close();
      return;
    }
    model = task;
    buttons();
    void loop(token);
  } catch (err) {
    if (token === generation)
      stop(
        err.name === 'NotAllowedError'
          ? 'Camera access was denied. Check Windows camera permissions and try again.'
          : err.name === 'NotFoundError'
            ? 'No camera found. The study timer is available.'
            : 'Camera unavailable. ' + err.message,
      );
  }
}
$('camera-button').onclick = () => (running ? stop('Camera off. The study timer continues.') : start());
$('recalibrate').onclick = () => {
  reset();
  void act('recalibrate');
  buttons();
  message('Hold your comfortable position for 10 seconds.');
};
$('view').onchange = framing;
$('markers').onchange = framing;
$('capture').onchange = (e) => act('capture', e.target.checked);
$('export-labels').onclick = () => act('exportLabels');
labels.forEach((label, i) => {
  const b = node('button', i + 1 + ' · ' + titles[i]);
  b.onclick = () => act('label', label);
  $('labels').append(b);
});
document.addEventListener('keydown', (e) => {
  if (
    !state?.collecting ||
    e.repeat ||
    e.altKey ||
    e.ctrlKey ||
    e.metaKey ||
    /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)
  )
    return;
  const label = labels[Number(e.key) - 1];
  if (label) {
    e.preventDefault();
    void act('label', label);
  }
});
observe((next) => {
  state = next;
  if (!state.session && running) stop('Session ended. Camera released.', false);
  else if (!state.session) message('Start a study session to enable the camera.');
  else if (!running && $('sensor-message').textContent.startsWith('Start a study'))
    message('Camera ready. Start when your framing is set.');
  buttons();
});
framing();
