import { measurePose, PostureTracker, sensitivities } from './pose.mjs';
import { requestCamera, runCamera, cameraError } from './camera.mjs';
import { advanceTimer, beginBreak, breakLength, finishBreak, formatClock, idleTimer,
  pauseTimer, remaining, restoreTimer, startTimer } from './breaks.mjs';
import { demoLandmarks, paintDemo, paintTracking, setIcon } from './graphics.mjs';
import { read, write, readActivity, readSettings, recordActivity } from './storage.mjs';

const byId = (id) => document.getElementById(id);
const cameraMain = byId('camera-primary');
const cameraOther = byId('camera-secondary');
const stage = byId('camera-stage');
const video = byId('camera-video');
const overlay = byId('tracking-overlay');
const demoImage = byId('demo-image');
const timerMain = byId('timer-primary');
const timerOther = byId('timer-secondary');
const summaryDialog = byId('summary-dialog');
const intervalButtons = [...document.querySelectorAll('[data-interval]')];
const pages = ['session', 'activity', 'settings'];
const wakeLock = navigator.wakeLock;

let settings = readSettings();
let lens = read('lens') === 'environment' ? 'environment' : 'user';
let activity = readActivity();
let timer = restoreTimer(read('timer'));
let session = null;
let sessionError = '';
let summaryEntry = null;
let view = '';
let audioContext;
let wakeSentinel;
let requestingWake = false;
let toastTimeout;

document.querySelectorAll('[data-icon]').forEach((icon) => setIcon(icon, icon.dataset.icon));

function setText(element, value) {
  if (element.textContent !== value) element.textContent = value;
}

function button(element, label, icon) {
  setText(element.querySelector('span'), label);
  setIcon(element.querySelector('i'), icon);
}

function toast(message) {
  const element = byId('toast');
  element.hidden = false;
  setText(element, message);
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => { element.hidden = true; }, 4000);
}

function unlockSound() {
  if (!settings.sound) return;
  const Sound = window.AudioContext ?? window.webkitAudioContext;
  if (!Sound) return;
  try {
    audioContext ??= new Sound();
    if (audioContext.state !== 'running') void audioContext.resume().catch(() => {});
  } catch {
    // Visual cues remain available without audio.
  }
}

function tone(kind = 'posture') {
  if (!settings.sound || audioContext?.state !== 'running' || document.hidden) return;
  const pitches = kind === 'posture' ? [520, 660] : [440, 550, 660];
  pitches.forEach((pitch, index) => {
    const oscillator = audioContext.createOscillator();
    const volume = audioContext.createGain();
    const at = audioContext.currentTime + index * 0.11;
    oscillator.frequency.setValueAtTime(pitch, at);
    volume.gain.setValueAtTime(0.0001, at);
    volume.gain.exponentialRampToValueAtTime(0.12, at + 0.025);
    volume.gain.exponentialRampToValueAtTime(0.0001, at + 0.28);
    oscillator.connect(volume);
    volume.connect(audioContext.destination);
    oscillator.start(at);
    oscillator.stop(at + 0.3);
  });
}

function wantsWakeLock() {
  return settings.awake && !document.hidden
    && (session?.kind === 'camera' || timer.phase === 'focus' || timer.phase === 'break');
}

async function syncWakeLock() {
  if (!wakeLock) return;
  if (!wantsWakeLock()) {
    const previous = wakeSentinel;
    wakeSentinel = null;
    if (previous) await previous.release().catch(() => {});
    return;
  }
  if (requestingWake || (wakeSentinel && !wakeSentinel.released)) return;
  requestingWake = true;
  try {
    const lock = await wakeLock.request('screen');
    if (wantsWakeLock()) wakeSentinel = lock;
    else await lock.release();
  } catch {
    // The browser may deny the lock when power is low or the page is inactive.
  } finally {
    requestingWake = false;
  }
}

const cameraMessages = {
  opening: 'Waiting for camera permission…',
  loading: 'Preparing posture tracking…',
  framing: 'Turn side-on and bring your head and torso into view.',
  ready: 'Side profile found. Calibrate when you’re comfortable.',
  calibrating: 'Stay in your comfortable position for a moment.',
  hold: 'Hold still with your ear, shoulder, and hip in view.',
  tracking: 'Watching for sustained changes from your reference.',
  away: 'Tracking paused. Bring your side profile back into view.',
  muted: 'Posture cues paused.',
  cue: 'Time to change position?',
};

function renderCamera() {
  const current = session;
  const isDemo = current?.kind === 'demo';
  const isLive = current?.kind === 'camera' && current.preview;
  const mode = isDemo ? 'demo' : isLive ? 'camera' : current ? 'loading' : 'off';
  const status = current?.result.status;
  const calibrated = Boolean(current?.tracker.baseline);
  const calibrating = current?.tracker.calibrating;
  const starting = ['opening', 'loading'].includes(status);
  const snoozed = current && Date.now() < current.snoozeUntil;

  stage.dataset.mode = mode;
  byId('setup-photo').hidden = isDemo || isLive;
  video.hidden = !isLive;
  demoImage.hidden = !isDemo;
  overlay.hidden = !isDemo && !isLive;
  setText(byId('stage-label'), isDemo ? 'Simulated view' : isLive ? 'Your camera' : 'Setup example');
  const stageStatus = byId('stage-status');
  stageStatus.hidden = !current;
  stageStatus.dataset.tone = status === 'cue' ? 'cue' : 'normal';
  const message = cameraMessages[status === 'shifting' ? 'tracking' : status] ?? '';
  setText(byId('stage-message'), message);
  setText(byId('camera-live'), sessionError || message);
  const progress = byId('stage-progress');
  progress.hidden = !calibrating;
  progress.value = current?.result.progress ?? 0;

  const label = isDemo ? 'Demo' : starting ? 'Starting' : status === 'cue' ? 'Posture cue' : isLive ? 'Camera on' : 'Camera off';
  byId('camera-indicator').dataset.tone = status === 'cue' ? 'cue' : isLive || isDemo ? 'active' : 'off';
  setText(byId('camera-label'), label);
  byId('calibrate-again').hidden = !calibrated || isDemo;

  cameraMain.disabled = !isDemo && current && !calibrated && !starting && status !== 'ready';
  cameraOther.disabled = Boolean(isDemo && !calibrated);
  cameraOther.hidden = Boolean(current && starting);
  const tip = byId('camera-tip');
  tip.dataset.error = String(Boolean(sessionError));

  if (!current) {
    button(cameraMain, sessionError ? 'Retry camera' : 'Start camera', 'video');
    button(cameraOther, 'Try demo', 'play');
    setText(tip, sessionError || 'Set your phone at shoulder height with a clear side view from head to hip.');
  } else if (starting) {
    button(cameraMain, 'Cancel', 'x');
    setText(tip, 'The camera only runs during this session.');
  } else if (isDemo) {
    button(cameraMain, 'Exit demo', 'x');
    button(cameraOther, current.demoTarget ? 'Return to reference' : 'Simulate head shift', 'activity');
    setText(tip, 'Try a sustained head shift to see how a cue will appear.');
  } else if (!calibrated) {
    button(cameraMain, calibrating ? 'Calibrating…' : 'Calibrate', 'focus');
    button(cameraOther, 'End session', 'stop');
    setText(tip, 'Choose a comfortable seated position and look toward your desk.');
  } else {
    button(cameraMain, 'End session', 'stop');
    button(cameraOther, snoozed ? 'Resume cues' : 'Snooze cues', snoozed ? 'bell' : 'clock');
    setText(tip, snoozed ? 'Cues snoozed for up to two minutes.' : 'Stay within the frame while you work.');
  }
}

function newSession(kind) {
  return {
    kind,
    tracker: new PostureTracker(),
    controller: new AbortController(),
    preview: false,
    frame: 0,
    result: { status: kind === 'demo' ? 'calibrating' : 'opening' },
    startedAt: 0,
    cues: 0,
    snoozeUntil: 0,
    demoTarget: 0,
    demoOffset: 0,
  };
}

function processFrame(current, landmarks, width, height, now) {
  if (session !== current) return;
  const sample = measurePose(landmarks, width, height, current.tracker.baseline);
  current.result = current.tracker.update(sample, now, {
    delay: settings.delay * 1000,
    threshold: sensitivities[settings.sensitivity],
    muted: Date.now() < current.snoozeUntil || ['due', 'break'].includes(timer.phase),
  });
  if (current.result.calibrated && !current.startedAt) current.startedAt = Date.now();
  if (current.result.alert) {
    current.cues++;
    tone();
  }
  if (width && height) paintTracking(overlay, sample?.points, width, height, current.result.status === 'cue');
  renderCamera();
}

function startCamera() {
  sessionError = '';
  let request;
  try {
    request = requestCamera(lens);
  } catch (error) {
    sessionError = cameraError(error);
    renderCamera();
    return;
  }
  unlockSound();
  const current = newSession('camera');
  session = current;
  renderCamera();
  void syncWakeLock();
  void runCamera({
    video,
    request,
    signal: current.controller.signal,
    onPreview() {
      current.preview = true;
      current.result = { status: 'loading' };
      renderCamera();
    },
    onReady() {
      current.result = { status: 'framing' };
      renderCamera();
    },
    onFrame(landmarks, width, height, now) {
      processFrame(current, landmarks, width, height, now);
    },
    onError(message) {
      if (session === current) endSession({ message });
    },
  });
}

function startDemo() {
  unlockSound();
  sessionError = '';
  const current = newSession('demo');
  current.tracker.calibrate();
  session = current;
  let previous = -Infinity;
  function step(now) {
    if (session !== current) return;
    if (now - previous >= 100) {
      previous = now;
      current.demoOffset += (current.demoTarget - current.demoOffset) * 0.27;
      paintDemo(demoImage, 720, 440, current.demoOffset);
      processFrame(current, demoLandmarks(current.demoOffset), 720, 440, now);
    }
    current.frame = requestAnimationFrame(step);
  }
  current.frame = requestAnimationFrame(step);
  renderCamera();
}

function calibrate() {
  session.tracker.calibrate();
  session.result = { status: 'calibrating', progress: 0 };
  renderCamera();
}

function entryId() {
  return globalThis.crypto?.randomUUID?.() ?? `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function saveEntry(entry) {
  const saved = recordActivity(entry, activity);
  activity = saved.entries;
  renderActivity();
  if (!saved.saved) toast('This browser could not save your activity.');
}

function endSession({ showSummary = false, message = '' } = {}) {
  const ended = session;
  if (!ended) return;
  session = null;
  ended.controller.abort();
  cancelAnimationFrame(ended.frame);
  sessionError = message;
  renderCamera();
  void syncWakeLock();
  if (ended.kind !== 'camera' || !ended.startedAt) return;
  const duration = Math.max(Date.now() - ended.startedAt, 0);
  if (duration < 1000) return;

  const entry = { id: entryId(), type: 'session', startedAt: ended.startedAt, duration, cues: ended.cues, comfort: '' };
  saveEntry(entry);
  if (!showSummary) return;
  summaryEntry = entry;
  setText(byId('summary-detail'), `${durationLabel(duration)} of camera time · ${countWord(ended.cues, 'cue')}`);
  summaryDialog.querySelectorAll('[name=comfort]').forEach((input) => { input.checked = false; });
  summaryDialog.showModal();
}

cameraMain.addEventListener('click', () => {
  if (!session) startCamera();
  else if (session.result.status === 'ready') calibrate();
  else endSession({ showSummary: true });
});

cameraOther.addEventListener('click', () => {
  if (!session) {
    startDemo();
  } else if (session.kind === 'demo') {
    session.demoTarget = session.demoTarget ? 0 : 0.093;
    renderCamera();
  } else if (!session.tracker.baseline) {
    endSession({ showSummary: true });
  } else {
    const now = Date.now();
    session.snoozeUntil = session.snoozeUntil > now ? 0 : now + 120_000;
    session.tracker.pendingSince = null;
    if (session.snoozeUntil) session.result = { status: 'muted' };
    renderCamera();
  }
});
byId('calibrate-again').addEventListener('click', calibrate);

const timerCopy = {
  idle: ['Ready when you are', 'Set a reminder to change position during desk time.', 'Start timer', 'play', 'Take a break now'],
  focus: ['Until the next break', 'Keep Formline open for your reminder.', 'Pause timer', 'pause', 'Take a break now'],
  paused: ['Timer paused', 'Resume when you’re ready to get back to work.', 'Resume timer', 'play', 'Take a break now'],
  due: ['Time to move', 'Take a moment to change your position.', 'Start a break', 'stretch', 'Snooze 5 min'],
  break: ['Movement break', '', 'Finish break', 'check', 'Skip break'],
};

function renderTimer(now = Date.now()) {
  const { phase, interval } = timer;
  const [title, detail, primary, icon, secondary] = timerCopy[phase];
  const left = remaining(timer, now);
  const fill = Math.min(100, 100 * left / (timer.total ?? interval * 60_000));
  byId('timer-ring').style.setProperty('--fill', `${fill}%`);
  setText(byId('timer-value'), formatClock(left));
  setText(byId('timer-status'), title);
  setText(byId('timer-detail'), phase !== 'break' ? detail : left > 40_000
    ? 'Change position in a way that feels comfortable.'
    : left > 20_000 ? 'Look away from the screen for a moment.'
      : 'Take your time before settling back in.');
  button(timerMain, primary, icon);
  setText(timerOther, secondary);
  byId('timer-reset').hidden = phase !== 'paused' && phase !== 'focus' && phase !== 'due';
  byId('interval-selector').hidden = phase === 'break' || phase === 'due';
  for (const control of intervalButtons) {
    control.disabled = phase === 'focus';
    control.setAttribute('aria-pressed', String(Number(control.dataset.interval) === interval));
  }
}

function setTimer(next) {
  timer = next;
  write('timer', timer);
  setText(byId('timer-live'), timerCopy[timer.phase][0]);
  renderTimer();
  void syncWakeLock();
}

function completeBreak(startedAt, duration) {
  saveEntry({
    id: `break-${startedAt}`, type: 'break', startedAt, duration, cues: 0, comfort: '',
  });
  tone('break');
  setText(byId('timer-live'), 'Movement break complete.');
  toast('Movement break complete');
}

function updateTimer() {
  if (document.hidden) return;
  const now = Date.now();
  const advanced = advanceTimer(timer, now);
  if (!advanced) {
    if (timer.phase === 'focus' || timer.phase === 'break') renderTimer(now);
    return;
  }
  const originalDeadline = timer.endsAt;
  setTimer(advanced.timer);
  if (advanced.event === 'due') {
    tone('break');
    toast('Time for a movement break');
  } else {
    completeBreak(originalDeadline - breakLength, breakLength);
  }
}

for (const control of intervalButtons) {
  control.addEventListener('click', () => setTimer(idleTimer(Number(control.dataset.interval))));
}

timerMain.addEventListener('click', () => {
  unlockSound();
  const now = Date.now();
  if (timer.phase === 'focus') setTimer(pauseTimer(timer, now));
  else if (timer.phase === 'due') setTimer(beginBreak(timer, now));
  else if (timer.phase === 'break') {
    const startedAt = timer.endsAt - breakLength;
    setTimer(finishBreak(timer, now));
    completeBreak(startedAt, Math.min(breakLength, Math.max(0, now - startedAt)));
  } else setTimer(startTimer(timer, now));
});

timerOther.addEventListener('click', () => {
  unlockSound();
  const now = Date.now();
  if (timer.phase === 'due') setTimer(startTimer(timer, now, 5 * 60_000));
  else if (timer.phase === 'break') setTimer(finishBreak(timer, now));
  else setTimer(beginBreak(timer, now));
});
byId('timer-reset').addEventListener('click', () => setTimer(idleTimer(timer.interval)));

function durationLabel(milliseconds) {
  if (milliseconds === 0) return '0 min';
  const seconds = Math.max(1, Math.round(milliseconds / 1000));
  if (seconds < 60) return `${seconds} sec`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} hr ${minutes % 60} min`;
}

function countWord(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function node(tag, className, content) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content !== undefined) element.textContent = content;
  return element;
}

function dayStart(date, offset = 0) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset).getTime();
}

const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const dayLabel = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
const eventDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function renderActivity() {
  const now = new Date();
  const today = activity.filter(({ startedAt }) => startedAt >= dayStart(now) && startedAt < dayStart(now, 1));
  const todaySessions = today.filter(({ type }) => type === 'session');
  setText(byId('today-time'), durationLabel(todaySessions.reduce((sum, session) => sum + session.duration, 0)));
  setText(byId('today-cues'), String(todaySessions.reduce((sum, session) => sum + session.cues, 0)));
  setText(byId('today-breaks'), String(today.filter(({ type }) => type === 'break').length));

  const days = Array.from({ length: 7 }, (_, index) => {
    const start = dayStart(now, index - 6);
    const end = dayStart(now, index - 5);
    const milliseconds = activity.filter(({ type, startedAt }) => type === 'session' && startedAt >= start && startedAt < end)
      .reduce((sum, entry) => sum + entry.duration, 0);
    return { start, milliseconds };
  });
  const scale = Math.max(60_000, ...days.map(({ milliseconds }) => milliseconds));
  const bars = days.map(({ start, milliseconds }, index) => {
    const item = node('li');
    const track = node('div', 'bar-track');
    track.setAttribute('aria-hidden', 'true');
    const fill = node('div', 'bar-fill');
    fill.dataset.empty = String(milliseconds === 0);
    fill.style.setProperty('--bar-size', `${100 * milliseconds / scale}%`);
    track.append(fill);
    const description = `${dayLabel.format(start)} · ${durationLabel(milliseconds)}`;
    item.title = description;
    item.append(track, node('span', '', index === 6 ? 'Today' : weekday.format(start)), node('span', 'sr-only', description));
    return item;
  });
  byId('week-chart').replaceChildren(...bars);
  byId('empty-history').hidden = activity.length > 0;

  const rows = activity.slice(0, 30).map((entry) => {
    const row = node('li');
    const mark = node('span', 'section-icon');
    const symbol = node('i');
    symbol.dataset.icon = entry.type === 'break' ? 'stretch' : 'video';
    setIcon(symbol, symbol.dataset.icon);
    mark.append(symbol);

    const info = node('div');
    const details = [durationLabel(entry.duration)];
    if (entry.type === 'session') details.push(countWord(entry.cues, 'cue'));
    if (entry.comfort) details.push(entry.comfort);
    info.append(node('p', '', entry.type === 'session' ? 'Camera session' : 'Movement break'),
      node('p', '', details.join(' · ')));
    const time = node('time', '', eventDate.format(entry.startedAt));
    time.dateTime = new Date(entry.startedAt).toISOString();
    row.append(mark, info, time);
    return row;
  });
  byId('history').replaceChildren(...rows);
}

function showPage(focus = true) {
  const requested = location.hash.slice(1);
  // The skip link targets the current landmark without changing the active page.
  if (requested === 'main' && view) {
    byId('main').focus();
    return;
  }
  const next = pages.includes(requested) ? requested : 'session';
  if (view === next) return;
  if (session && next !== 'session') endSession();
  for (const page of pages) byId(`page-${page}`).hidden = page !== next;
  document.querySelectorAll('[data-view]').forEach((link) => {
    if (link.dataset.view === next) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  view = next;
  if (next === 'activity') renderActivity();
  if (focus) {
    window.scrollTo(0, 0);
    byId(`${view}-heading`).focus({ preventScroll: true });
  }
}

function renderSettings() {
  byId('cue-delay').value = settings.delay;
  byId('sensitivity').value = settings.sensitivity;
  byId('cue-sound').checked = settings.sound;
  byId('keep-awake').checked = settings.awake;
  byId('preview-sound').disabled = !settings.sound;
  byId('camera-facing').value = lens;
}

function updateSettings(next) {
  settings = { ...settings, ...next };
  write('settings', settings);
  renderSettings();
  void syncWakeLock();
}

byId('cue-delay').addEventListener('change', (event) => updateSettings({ delay: Number(event.target.value) }));
byId('sensitivity').addEventListener('change', (event) => updateSettings({ sensitivity: event.target.value }));
byId('cue-sound').addEventListener('change', (event) => {
  updateSettings({ sound: event.target.checked });
  unlockSound();
});
byId('keep-awake').addEventListener('change', (event) => updateSettings({ awake: event.target.checked }));
byId('camera-facing').addEventListener('change', (event) => {
  lens = event.target.value;
  write('lens', lens);
});
byId('preview-sound').addEventListener('click', async () => {
  unlockSound();
  await audioContext?.resume().catch(() => {});
  tone();
});

document.querySelectorAll('[data-open-install]').forEach((control) => {
  control.addEventListener('click', () => byId('install-dialog').showModal());
});
document.querySelectorAll('[data-close-dialog]').forEach((control) => {
  control.addEventListener('click', () => control.closest('dialog').close());
});
summaryDialog.addEventListener('change', (event) => {
  if (summaryEntry && event.target.name === 'comfort') {
    summaryEntry = { ...summaryEntry, comfort: event.target.value };
    saveEntry(summaryEntry);
  }
});
summaryDialog.addEventListener('close', () => { summaryEntry = null; });
byId('clear-activity').addEventListener('click', () => byId('clear-dialog').showModal());
byId('confirm-clear').addEventListener('click', () => {
  activity = [];
  const cleared = write('activity', activity);
  renderActivity();
  byId('clear-dialog').close();
  toast(cleared ? 'Activity cleared' : 'Saved activity could not be cleared');
});

window.addEventListener('hashchange', () => showPage());
window.addEventListener('pagehide', () => endSession());
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    endSession({ message: session?.kind === 'camera' ? 'The camera stopped when you left Formline.' : '' });
  } else {
    renderActivity();
    updateTimer();
  }
  void syncWakeLock();
});
window.addEventListener('storage', (event) => {
  if (event.key === 'formline.activity') {
    activity = readActivity();
    renderActivity();
  }
});

renderCamera();
renderTimer();
renderActivity();
renderSettings();
showPage(false);
updateTimer();
void syncWakeLock();
setInterval(updateTimer, 250);
if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('./sw.js').catch((error) => console.warn('Offline setup was unavailable.', error));
}
