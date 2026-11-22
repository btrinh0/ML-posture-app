export const intervals = [25, 40, 60];
export const breakLength = 60_000;
const minute = 60_000;

export function idleTimer(interval = 25) {
  return { phase: 'idle', interval };
}

export function restoreTimer(value) {
  const interval = intervals.includes(value?.interval) ? value.interval : 25;
  if (value?.phase === 'paused' && Number.isFinite(value.left)
    && value.left > 0 && value.left <= interval * minute) {
    const total = Number.isFinite(value.total) && value.total >= value.left && value.total <= interval * minute
      ? value.total : interval * minute;
    return { phase: 'paused', interval, left: value.left, total };
  }
  if (value?.phase === 'due') return { phase: 'due', interval };
  if (['focus', 'break'].includes(value?.phase) && Number.isFinite(value.endsAt)) {
    const total = value.phase === 'focus' ? value.total : breakLength;
    if (Number.isFinite(total) && total > 0 && total <= interval * minute) {
      return { phase: value.phase, interval, endsAt: value.endsAt, total, repeat: value.repeat === true };
    }
  }
  return idleTimer(interval);
}

export function startTimer(timer, now, duration) {
  const left = duration ?? timer.left ?? timer.interval * minute;
  const total = timer.phase === 'paused' && duration === undefined ? timer.total : left;
  return { phase: 'focus', interval: timer.interval, total, endsAt: now + left };
}

export function pauseTimer(timer, now) {
  const left = Math.max(0, Math.min(timer.total, timer.endsAt - now));
  return left ? { phase: 'paused', interval: timer.interval, left, total: timer.total }
    : { phase: 'due', interval: timer.interval };
}

export function beginBreak(timer, now) {
  return {
    phase: 'break',
    interval: timer.interval,
    endsAt: now + breakLength,
    total: breakLength,
    repeat: ['focus', 'due'].includes(timer.phase),
  };
}

export function finishBreak(timer, now) {
  return timer.repeat ? startTimer(timer, now) : idleTimer(timer.interval);
}

export function remaining(timer, now) {
  if (timer.phase === 'due') return 0;
  if (timer.phase === 'paused') return timer.left;
  if (timer.phase === 'focus' || timer.phase === 'break') return Math.max(0, timer.endsAt - now);
  return timer.interval * minute;
}

export function advanceTimer(timer, now) {
  if ((timer.phase !== 'focus' && timer.phase !== 'break') || remaining(timer, now) > 0) return null;
  if (timer.phase === 'focus') {
    return { timer: { phase: 'due', interval: timer.interval }, event: 'due' };
  }
  return { timer: finishBreak(timer, now), event: 'completed' };
}

export function formatClock(milliseconds) {
  const seconds = Math.ceil(milliseconds / 1000);
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
}
