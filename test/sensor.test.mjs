import test from 'node:test';
import assert from 'node:assert/strict';
import { calibrated, Calibration, geometry } from '../shared/kinematics.mjs';
import { DeskStore } from '../desktop/store.mjs';

function side(shift = 0, mirror = false) {
  const points = [];
  for (const [i, x, y] of [
    [0, 0.52 + shift, 0.25],
    [7, 0.45 + shift, 0.26],
    [11, 0.43, 0.43],
    [23, 0.42, 0.78],
  ]) {
    points[i] = { x: mirror ? 1 - x : x, y, visibility: 1, presence: 1 };
  }
  return geometry(points, 640, 480, 'side');
}
test('side-view deltas respect mirror, scale and missing landmarks', () => {
  const m = calibrated(side(0.055), side()),
    mirror = calibrated(side(0.055, true), side(0, true));
  assert.ok(m.drop > 7 && m.moment > 0);
  assert.equal(m.asym, null);
  assert.ok(Math.abs(m.drop - mirror.drop) < 1e-10);
  assert.equal(geometry([], 640, 480, 'side'), null);
});
test('front-view elevation needs visible bilateral landmarks and reports anatomical side', () => {
  const pts = [];
  for (const [i, x, y] of [
    [0, 0.5, 0.2],
    [11, 0.65, 0.4],
    [12, 0.35, 0.4],
    [23, 0.59, 0.8],
    [24, 0.41, 0.8],
  ])
    pts[i] = { x, y, visibility: 1 };
  const baseline = geometry(pts, 640, 480, 'front');
  pts[11].y -= 0.05;
  const m = calibrated(geometry(pts, 640, 480, 'front'), baseline);
  assert.ok(m.asym > 0);
  assert.equal(m.cva, null);
  assert.equal(m.vector, null);
  pts[12].visibility = 0.2;
  assert.equal(geometry(pts, 640, 480, 'front'), null);
});
