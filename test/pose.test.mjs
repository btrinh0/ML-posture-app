import assert from 'node:assert/strict';
import test from 'node:test';
import { measurePose, PostureTracker } from '../app/pose.mjs';
import { demoLandmarks } from '../app/graphics.mjs';

const width = 720;
const height = 440;
const comfortable = () => measurePose(demoLandmarks(0), width, height);
const forward = () => measurePose(demoLandmarks(0.09), width, height);

test('side view measures forward drift in either mirrored camera orientation', () => {
  const neutral = comfortable();
  const lean = forward();
  assert.ok(neutral && lean);
  assert.ok(lean.offset - neutral.offset > 0.25);
  const mirrored = demoLandmarks(0.09).map((point) => ({ ...point, x: 1 - point.x }));
  const result = measurePose(mirrored, width, height);
  assert.equal(result.facing, -lean.facing);
  assert.ok(Math.abs(result.offset - lean.offset) < 1e-12);
});

test('a rigid torso rotation and a head shift are different signals', () => {
  const pose = demoLandmarks(0.02);
  const hip = pose[23];
  const theta = -0.2;
  const rotated = pose.map((point) => {
    const x = (point.x - hip.x) * width;
    const y = (point.y - hip.y) * height;
    return {
      ...point,
      x: hip.x + (x * Math.cos(theta) - y * Math.sin(theta)) / width,
      y: hip.y + (x * Math.sin(theta) + y * Math.cos(theta)) / height,
    };
  });
  const original = measurePose(pose, width, height);
  const result = measurePose(rotated, width, height, original);
  assert.ok(original && result);
  assert.ok(Math.abs(result.offset - original.offset) < 1e-12);
});

test('profile and visibility gates decline unsuitable camera frames', () => {
  const pose = demoLandmarks(0);
  pose[12] = { ...pose[11], x: 0.65 };
  assert.equal(measurePose(pose, width, height), null);
  delete pose[12];
  pose[23].visibility = 0.3;
  assert.equal(measurePose(pose, width, height), null);
});

test('losing tracking during calibration restarts the calibration window', () => {
  const tracker = new PostureTracker();
  const neutral = comfortable();
  tracker.calibrate();
  for (let now = 0; now < 1800; now += 200) tracker.update(neutral, now);
  assert.equal(tracker.update(null, 1800).status, 'hold');
  for (let now = 2000; now < 5000; now += 200) {
    assert.notEqual(tracker.update(neutral, now).status, 'tracking');
  }
  assert.equal(tracker.update(neutral, 5000).calibrated, true);
});

test('brief shifts, lost frames and snoozed cues cannot satisfy the alert delay', () => {
  const tracker = new PostureTracker();
  const neutral = comfortable();
  const lean = forward();
  tracker.calibrate();
  for (let now = 0; now <= 3000; now += 200) tracker.update(neutral, now);

  for (let now = 3200; now < 7200; now += 200) assert.equal(tracker.update(lean, now).alert, undefined);
  assert.equal(tracker.update(null, 7200).status, 'away');
  for (let now = 7400; now < 15_000; now += 200) assert.equal(tracker.update(lean, now).alert, undefined);
  for (let now = 15_000; now < 25_000; now += 200) {
    assert.equal(tracker.update(lean, now, { muted: true }).status, 'muted');
  }
  for (let now = 25_000; now < 33_000; now += 200) assert.equal(tracker.update(lean, now).alert, undefined);
  assert.equal(tracker.update(lean, 33_000).alert, true);
  for (let now = 33_200; now < 90_000; now += 200) assert.equal(tracker.update(lean, now).alert, undefined);
});
