import { $, node, observe, act, feedback } from './dashboard.mjs';
import { drawLandmarks } from './pose-overlay.mjs';
import {
  Calibration,
  geometry,
} from './shared/kinematics.mjs';

let state,
  device = null,
  model = null,
  generation = 0,
  running = false,
  timeout;
let cameraRate, lastMarkerVisible = false;
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
const video = $('video');
const titles = ['Neutral', 'Sustained slouch', 'Writing', 'Brief reading', 'Reaching / shifting'];
const message = (text) => {
  if ($('sensor-message').textContent !== text) $('sensor-message').textContent = text;
};
function framing() {
  $('framing').textContent =
    $('view').value === 'side'
      ? 'Level the camera beside you. Keep the near ear, shoulder and hip in frame. Hold still for 10 seconds.'
      : 'Face a level camera with both shoulders and hips visible. Hold still for 10 seconds.';
}
function reset() {
  calibration = new Calibration();
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
}
async function noTracking() {}
async function loop(token) {
  if (!running || token !== generation) return;
  const started = performance.now();
  const rate = 12;
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
      drawLandmarks($('landmark-overlay'), points, video);
      const g = geometry(
        points,
        video.videoWidth,
        video.videoHeight,
        $('view').value,
        calibration.reference || calibration.samples[0],
      );
      if (!calibration.reference) {
        const progress = calibration.update(g, started);
        message(g ? 'Hold a comfortable neutral position.' : 'Waiting for a visible pose.');
        if (calibration.reference) buttons();
      } else {
        const m = g ? { view: g.view, cva: g.raw[0] } : null;
        if (!m) {
          await noTracking(started);
          message('Tracking paused. Return to the calibrated view or recalibrate.');
        } else {
          lastValid = true;
          const second = Math.floor(Date.now() / 1000);
          if (second !== lastSecond) {
            $('readings').textContent = m.cva == null ? 'Front view' : 'Ear–shoulder proxy ' + m.cva.toFixed(1) + '°';
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
$('view').onchange = framing;
observe((next) => {
  state = next;
  if (!state.session && running) stop('Session ended. Camera released.', false);
  else if (!state.session) message('Start a study session to enable the camera.');
  else if (!running && $('sensor-message').textContent.startsWith('Start a study'))
    message('Camera ready. Start when your framing is set.');
  buttons();
});
framing();
