import test from 'node:test';
import assert from 'node:assert/strict';
import { DeskStore } from '../desktop/store.mjs';
import { Telemetry } from '../desktop/telemetry.mjs';
import { Insights } from '../desktop/insights.mjs';

test('a live forecast is saved, resolved and included once in the outcome report', () => {
  let now = new Date('2026-04-30T09:00:00').getTime();
  const store = new DeskStore(':memory:', () => now);
  new Telemetry(store);
  const insights = new Insights(store);
  const beginning = now;
  function visit(day, losses) {
    now = beginning + day * 86_400_000;
    store.start();
    const session = store.session;
    let prompt;
    for (let m = 0; m < losses.length; m++) for (let sec = 0; sec < 12; sec++) {
      now = beginning + day * 86_400_000 + (60*m + sec)*1000;
      session.active_ms = (60*m + sec)*1000;
      store.run("INSERT INTO samples(session,sec,active_ms,view,cva,drop_deg,neutral,prediction,segment) VALUES(?,?,?,'side',?,?,1,'neutral',0)",
        session.id, now/1000, session.active_ms, 70-losses[m], losses[m]);
      if (day >= 14 && !prompt) prompt = insights.sensorReminder(false,{view:'side',drop:losses[m]},'neutral');
    }
    if (prompt) store.resolve(prompt.id, 'completed');
    store.end();
    return prompt;
  }
  for (let day = 0; day < 14; day++) visit(day, Array.from({length:10}, (_, m) => .2*m));
  const cue = visit(14,[0,0,0,0,.4,.6,.8,1.1,2.2,4,5.8]);
  assert.equal(cue?.kind, 'forecast');
  const report = insights.report(7);
  assert.equal(report.series.at(-1).completed, 1);
  assert.equal(report.prompts.find(p => p.kind === 'forecast' && p.outcome === 'completed').n, 1);
  store.close();
});
