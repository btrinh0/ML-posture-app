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
