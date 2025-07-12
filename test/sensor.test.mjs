import test from 'node:test';
import assert from 'node:assert/strict';
import { geometry } from '../shared/kinematics.mjs';
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
test('frontal shoulder heights retain the side of elevation', () => {
  const pose = Array(33);
  for (const [id,x,y] of [[0,.5,.2],[11,.37,.38],[12,.63,.42],[23,.4,.7],[24,.60,.7]])
    pose[id] = { x, y, visibility: 1 };
  assert.ok(geometry(pose, 800, 800, 'front').raw[0] > 0);
});
