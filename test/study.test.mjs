import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateBundle } from '../shared/model-format.mjs';

const load = (name) => JSON.parse(readFileSync(new URL('../research/generated/' + name, import.meta.url), 'utf8'));
test('the shipped simulation matches the selection rule, recorded visits, and diary coverage', () => {
  const report = load('benchmark.json'), examples = load('dashboard.json'), diary = load('diary.json');
  const model = validateBundle(load('activity.deskmodel'));
  assert.equal(model.provenance, 'simulated_study');
  assert.equal(examples.provenance, model.provenance);
  assert.throws(() => validateBundle({ ...model, provenance: 'synthetic_smoke' }));
  const eligible = Object.entries(report.results.leave_one_session_out).filter(([, m]) => m.p95_ms < 15);
  const winner = eligible.sort(([, a], [, b]) => b.macro_f1 - a.macro_f1 ||
    a.false_alerts_per_hour - b.false_alerts_per_hour || a.p95_ms - b.p95_ms)[0][0];
  assert.equal(report.selected, winner);
  assert.equal(model.variant === 'mean_and_latest' ? 'tree_levels_only' : model.kind, winner);
  assert.equal(report.sessions, 9);
  assert.equal(report.follow_up.sessions, 3);
  for (const name of diary.people) {
    const key = name.toLowerCase(), data = examples.reports[key][28];
    const records = diary.days.filter((r) => r.participant === 'sim-' + key);
    assert.equal(records.length, 28);
    assert.equal(data.weeks.length, 4);
    assert.equal(data.history.days, 28);
    assert.equal(data.changes[0].title, records.find((r) => r.intervention).intervention);
    assert.deepEqual(data.series.map((d) => d.jaw), records.map((r) => r.symptoms?.jaw ?? null));
    assert.ok(data.weeks.every((w) => w.cva !== null && w.marker_cva === null));
    assert.equal(data.series.reduce((n,d) => n+d.completed, 0), records.filter((r) => r.response === 'completed').length);
    assert.equal(examples.controlled[key].stable.onset, null);
  }
});
