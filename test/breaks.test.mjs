import assert from 'node:assert/strict';
import test from 'node:test';
import { advanceTimer, beginBreak, breakLength, idleTimer, pauseTimer,
  remaining, restoreTimer, startTimer } from '../app/breaks.mjs';

test('restored desk timer uses its wall clock deadline after suspension', () => {
  const timer = startTimer(idleTimer(25), 1000);
  const restored = restoreTimer(JSON.parse(JSON.stringify(timer)));
  assert.equal(remaining(restored, 61_000), 24 * 60_000);
  assert.equal(advanceTimer(restored, timer.endsAt - 1), null);
  assert.deepEqual(advanceTimer(restored, timer.endsAt + 100), {
    event: 'due', timer: { phase: 'due', interval: 25 },
  });
});

test('pause preserves remaining time and a resumed timer expires once', () => {
  const timer = startTimer(idleTimer(40), 10_000);
  const paused = pauseTimer(timer, 70_000);
  assert.equal(paused.phase, 'paused');
  assert.equal(remaining(paused, 200_000), 39 * 60_000);
  const resumed = startTimer(restoreTimer(paused), 200_000);
  assert.equal(resumed.total, 40 * 60_000);
  const ready = advanceTimer(resumed, resumed.endsAt);
  assert.equal(ready.event, 'due');
  assert.equal(advanceTimer(ready.timer, resumed.endsAt + 60_000), null);
});

test('a standalone break returns to idle while a desk break starts another interval', () => {
  const standalone = beginBreak(idleTimer(), 1000);
  assert.equal(advanceTimer(standalone, 1000 + breakLength).timer.phase, 'idle');
  const work = startTimer(idleTimer(60), 1000);
  const next = advanceTimer(beginBreak(work, 5000), 5000 + breakLength);
  assert.equal(next.event, 'completed');
  assert.equal(next.timer.phase, 'focus');
  assert.equal(remaining(next.timer, 5000 + breakLength), 60 * 60_000);
});
