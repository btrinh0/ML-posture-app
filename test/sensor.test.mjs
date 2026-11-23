import test from 'node:test';
import assert from 'node:assert/strict';
import { calibrated, Calibration, DriftGate, geometry, samplingRate } from '../shared/kinematics.mjs';
import { DeskStore } from '../desktop/store.mjs';
import { Telemetry } from '../desktop/telemetry.mjs';

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
  assert.equal(calibrated({ ...side(), scale: 3 }, side()), null);
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
test('calibration requires ten continuous seconds and drift cues rearm after recovery', () => {
  const c = new Calibration();
  for (let t = 0; t < 10_000; t += 500) c.update(side(), t);
  assert.equal(c.reference, null);
  c.update(null, 10_000);
  for (let t = 11_000; t <= 21_000; t += 500) c.update(side(), t);
  assert.ok(c.reference);
  const gate = new DriftGate();
  for (let t = 0; t < 15_000; t += 1000) assert.equal(gate.update(true, t), false);
  assert.equal(gate.update(true, 15_000), true);
  assert.equal(gate.update(true, 16_000), false);
  gate.update(false, 17_000);
  assert.equal(gate.update(true, 18_000), false);
  assert.equal(samplingRate({ idle: true, fixed: true }), 0);
  assert.equal(samplingRate({ calibrated: true }), 1);
  assert.equal(samplingRate({ calibrated: true, verify: true }), 12);
});
test('one numeric record per second, with research vectors only during labeled capture', () => {
  let now = Date.now();
  const s = new DeskStore(':memory:', () => now);
  s.start();
  const t = new Telemetry(s),
    metrics = calibrated(side(), side());
  const p = { session: s.session.id, metrics, rate: 1 };
  assert.equal(t.sample(p), true);
  assert.equal(t.sample(p), false);
  assert.deepEqual(t.exportRows(), []);
  t.collect(true);
  t.mark('writing');
  now += 1000;
  t.sample(p);
  t.collect(false);
  now += 1000;
  t.sample(p);
  assert.equal(s.get('SELECT count(*) AS n FROM samples').n, 3);
  const rows = t.exportRows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].label, 'writing');
  assert.equal(rows[0].vector.length, 10);
  assert.equal(rows[0].alias, undefined);
  s.end();
  s.addProfile('other');
  assert.deepEqual(t.exportRows(), []);
  s.close();
});
