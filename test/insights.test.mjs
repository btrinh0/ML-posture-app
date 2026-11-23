import test from 'node:test';
import assert from 'node:assert/strict';
import { DeskStore } from '../desktop/store.mjs';
import { Telemetry } from '../desktop/telemetry.mjs';
import { Insights } from '../desktop/insights.mjs';
import { WindowBuffer, rollingFeatures } from '../shared/windows.mjs';

const base = new Date('2026-10-01T10:00:00').getTime();
const vector = (drop) => [drop, 0, 0, 0, 0, 0, 0, 0, 0, 0];
function rig() {
  let now = base;
  const store = new DeskStore(':memory:', () => now);
  const telemetry = new Telemetry(store),
    insights = new Insights(store);
  function advance(day, minute = 0, second = 0) {
    now = base + day * 86400000 + minute * 60000 + second * 1000;
  }
  function sample(drop, minute, second, view = 'side') {
    store.session.active_ms = minute * 60000 + second * 1000;
    const metrics = {
      view,
      cva: 70 - drop,
      drop,
      forward: 0,
      shoulder: 0,
      asym: 7,
      moment: 0,
      load: 0,
      vector: vector(drop),
    };
    telemetry.sample({
      session: store.session.id,
      metrics,
      prediction: view === 'side' ? 'neutral' : null,
      rate: 1,
    });
  }
  return { store, telemetry, insights, advance, sample };
}
test('weekly associations use paired days, tracked seconds, and profile-specific observations', () => {
  const { store: s, telemetry: t, insights, advance, sample } = rig();
  for (let day = 0; day < 3; day++) {
    advance(day);
    s.start();
    t.reset();
    s.checkIn({ jaw: day, neck: day, back: day });
    for (let sec = 0; sec < 20; sec++) {
      advance(day, 0, sec);
      sample(day * 4, 0, sec);
    }
    const p = s.prompt('timer', 'walk');
    s.resolve(p.id, 'completed');
    s.end();
  }
  const report = insights.report(7),
    week = report.weeks[0];
  assert.equal(week.paired, 3);
  assert.equal(week.seconds, 60);
  assert.equal(week.cva, 66);
  assert.equal(week.r_cva, -1);
  assert.equal(week.completed, 3);
  assert.equal(report.series.filter((d) => d.cva === null).length, 4);
  assert.equal(insights.weeklyPattern().drill, 'chin');
  s.addProfile('Different');
  assert.equal(insights.report(7).weeks[0].cva, null);
  assert.equal(insights.weeklyPattern(), null);
  s.close();
});
test('forecast waits for two weeks, then detects accelerating drift in a classified session', () => {
  const { store: s, telemetry: t, insights, advance, sample } = rig();
  for (let day = 0; day < 14; day++) {
    advance(day);
    s.start();
    t.reset();
    for (let m = 0; m < 10; m++)
      for (let sec = 0; sec < 12; sec++) {
        advance(day, m, sec);
        sample(m * 0.2, m, sec);
      }
    s.end();
    if (day === 12) assert.equal(insights.historicalSlope().slope, null);
  }
  advance(14);
  s.start();
  t.reset();
  assert.equal(insights.historicalSlope().days, 14);
  for (let m = 4; m <= 10; m++)
    for (let sec = 0; sec < 12; sec++) {
      advance(14, m, sec);
      sample([0.4, 0.6, 0.8, 1.1, 2.2, 4, 5.8][m - 4], m, sec);
    }
  const forecast = insights.forecast();
  assert.ok(forecast && forecast.minutes < 3);
  s.close();
});
test('explicit false-alarm feedback relabels its frozen opt-in interval only', () => {
  const { store: s, telemetry: t, advance, sample } = rig();
  s.start();
  t.reset();
  t.collect(true);
  for (let sec = 0; sec < 21; sec++) {
    advance(0, 0, sec);
    sample(9, 0, sec);
  }
  const p = s.prompt('drift', 'chin');
  t.freezeCorrection(p);
  advance(0, 0, 21);
  sample(9, 0, 21);
  s.resolve(p.id, 'false_positive', () => t.correct(p.id, 'writing'));
  const r = t.exportRows();
  assert.equal(r.length, 20);
  assert.equal(r[0].second, 1);
  assert.equal(r.at(-1).second, 20);
  assert.ok(r.every((v) => v.overridden === 1 && v.label === 'writing'));
  s.close();
});
test('a window resets across missing seconds and rolling slopes use elapsed seconds', () => {
  const b = new WindowBuffer();
  for (let sec = 0; sec < 19; sec++) assert.equal(b.push(sec, vector(sec)), null);
  assert.equal(b.push(20, vector(20)), null);
  let ready;
  for (let sec = 21; sec <= 39; sec++) ready = b.push(sec, vector(sec));
  const f = rollingFeatures(ready);
  assert.equal(f.length, 42);
  assert.equal(f[20], 1);
  assert.equal(f.at(-1), 20);
  assert.equal(b.push(39, vector(39)), null);
});
test('change comparisons use adjacent calendar weeks, distinguish zero from missing and stay profile-local', () => {
  const { store: s, insights, advance, sample } = rig();
  for (const day of [0, 1, 7, 8, 14, 15]) {
    advance(day);
    s.start();
    const score = day < 8 ? 0 : 4;
    s.checkIn({ jaw: score, neck: score, back: score });
    sample(score, 0, 0);
    s.end();
  }
  const input = { day: '2026-10-09', title: 'Raised screen' };
  s.markChange(input);
  s.markChange(input);
  const [change] = insights.report(7).changes;
  assert.equal(insights.report(28).changes.length, 1);
  assert.equal(change.before.logged_days, 2);
  assert.equal(change.before.pain, 0);
  assert.equal(change.before.cva, 70);
  assert.equal(change.after.logged_days, 2);
  assert.equal(change.after.pain, 4);
  assert.equal(change.after.cva, 66);
  assert.equal(change.after.last, '2026-10-15');
  assert.equal(change.inProgress, false);
  assert.throws(() => s.markChange({ ...input, day: '2026-02-30' }));
  assert.throws(() => s.markChange({ ...input, day: '2026-11-15' }));
  s.addProfile('Second');
  assert.deepEqual(insights.report(28).changes, []);
  s.markChange(input);
  assert.equal(insights.report(28).changes[0].before.pain, null);
  s.close();
});
