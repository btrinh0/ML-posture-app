import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { DeskStore } from '../desktop/store.mjs';
import { Insights } from '../desktop/insights.mjs';
import { Telemetry } from '../desktop/telemetry.mjs';
import { DriftGate, drifting, labels } from '../shared/kinematics.mjs';

const dir = resolve(process.argv[2] ?? 'research/generated');
const json = async (name) => JSON.parse(await readFile(join(dir, name), 'utf8'));
const diary = await json('diary.json'), benchmark = await json('benchmark.json');
if (diary.provenance !== 'simulated_study' || benchmark.provenance !== diary.provenance)
  throw new Error('The example dashboard requires simulated study records.');
async function loadVisits(file) {
  const rows = gunzipSync(await readFile(join(dir,file))).toString().trim().split('\n').map(JSON.parse);
  return new Map(rows.map((r) => [r.session, r]));
}
const visits = await loadVisits('replay.jsonl.gz'), cases = await loadVisits('forecast-cases.jsonl.gz');
const end = diary.days.at(-1).day;
const dashboard = { provenance: diary.provenance, start: diary.days[0].day, end, reports: {}, forecast: {}, timers: {}, controlled: {} };

function sampleSecond(s, insert, insights, v, sec, gate, missing) {
  const now = s.now();
  if (missing.has(sec)) { gate.update(null, now); return; }
  const value = { view: 'side', drop: v.loss[sec] / 10, forward: v.forward[sec] / 1000 };
  const prediction = v.predictions[sec] === 'n' ? null : labels[Number(v.predictions[sec])];
  insert.run(s.session.id, now / 1000, s.session.active_ms, v.baseline - value.drop, value.drop,
    value.forward, v.shoulder[sec] / 1000, Number(!drifting(value)), prediction);
  const cue = gate.update(prediction === null ? null : prediction === 'slouch', now);
  return insights.sensorReminder(cue, value, prediction);
}

// Score a prospective nudge only after it was issued. No future sample or
// activity annotation is passed to the app's forecaster or alert gate.
function leadToSlouch(visit, now, missing) {
  let consecutive = 0;
  for (let t = now + 1; t < Math.min(visit.loss.length, now + 181); t++) {
    consecutive = !missing.has(t) && visit.activity[t] === '1' && visit.loss[t] >= 70 ? consecutive + 1 : 0;
    if (consecutive === 15) return t - 14 - now;
  }
  return null;
}
for (const name of diary.people) {
  const key = name.toLowerCase(), records = diary.days.filter((d) => d.participant === 'sim-' + key);
  let now = 0;
  const s = new DeskStore(':memory:', () => now);
  new Telemetry(s);
  const insights = new Insights(s);
  const insert = s.db.prepare(`INSERT INTO samples(session,sec,active_ms,view,cva,drop_deg,forward,shoulder,neutral,prediction,segment)
    VALUES(?,?,?,'side',?,?,?,?,?,?,0)`);
  const forecast = { issued: 0, evaluable: 0, followed_by_slouch: 0, lead_seconds: [] };
  const timers = { scheduled: 0, during_neutral: 0, during_slouch: 0 };
  for (const day of records) {
    const v = visits.get(day.session);
    const length = day.active_minutes * 60;
    if (!v || v.predictions.length !== length || v.activity?.length !== length)
      throw new Error('Regenerate the model replay for ' + day.session);
    const start = new Date(day.day + 'T' + String(day.local_hour).padStart(2, '0') + ':00:00').getTime();
    now = start;
    s.start();
    const missing = new Set(v.missing);
    const gate = new DriftGate();
    let planned = false;
    for (let sec = 0; sec < length; sec++) {
      now = start + sec * 1000;
      s.session.active_ms = sec * 1000;
      s.session.last_tick = now;
      if (sec === 1800) {
        timers.scheduled++;
        if (v.activity[sec] === '0') timers.during_neutral++;
        if (v.activity[sec] === '1') timers.during_slouch++;
      }
      // Each diary schedules one exercise. The simulated participant dismisses
      // other reminders so the original time series stays available for scoring.
      if (sec >= 25 * 60 && !planned) {
        const p = s.prompt('study_drill', day.drill);
        if (p) { s.resolve(p.id, day.response); planned = true; }
      }
      const p = sampleSecond(s, insert, insights, v, sec, gate, missing);
      if (!p) continue;
      s.resolve(p.id, 'skipped');
      if (p.kind === 'forecast') {
        forecast.issued++;
        if (sec + 180 < length && !v.missing.some((t) => t > sec && t <= sec + 180)) {
          forecast.evaluable++;
          const lead = leadToSlouch(v, sec, missing);
          if (lead !== null) {
            forecast.followed_by_slouch++;
            forecast.lead_seconds.push(lead);
          }
        }
      }
    }
    now = start + length * 1000;
    s.session.active_ms = length * 1000;
    s.session.last_tick = now;
    s.end();
    if (day.symptoms) s.checkIn(day.symptoms);
    if (day.intervention) s.markChange({ day: day.day, title: day.intervention });
  }
  now = new Date(end + 'T23:59:59').getTime();
  dashboard.reports[key] = Object.fromEntries([7, 28, 84].map((days) => [days, insights.report(days)]));
  dashboard.forecast[key] = forecast;
  dashboard.timers[key] = timers;
  dashboard.controlled[key] = {};
  for (const scenario of ['stable','progressive']) {
    const v = cases.get(key + '-' + scenario);
    const start = new Date(end + 'T12:00:00').getTime() + 86400_000;
    now = start;
    s.start();
    const id = s.session.id, holdout = new Insights(s), gate = new DriftGate(), missing = new Set(v.missing);
    const nudges = [];
    for (let sec = 0; sec < v.loss.length; sec++) {
      now = start + sec * 1000;
      s.session.active_ms = sec * 1000;
      s.session.last_tick = now;
      const p = sampleSecond(s, insert, holdout, v, sec, gate, missing);
      if (p) { if (p.kind === 'forecast') nudges.push(sec); s.resolve(p.id, 'skipped'); }
    }
    s.end();
    const onset = v.activity.indexOf('1');
    const warning = nudges.find((t) => t < onset && onset - t <= 180);
    dashboard.controlled[key][scenario] = { onset: onset < 0 ? null : onset, nudges, lead_seconds: warning === undefined ? null : onset - warning };
    // Both cases start with exactly the same 28 days of history in this in-memory database.
    for (const tbl of ['prompts','samples']) s.run('DELETE FROM ' + tbl + ' WHERE session=?', id);
    s.run('DELETE FROM sessions WHERE id=?', id);
  }
  s.close();
}
await writeFile(join(dir, 'dashboard.json'), JSON.stringify(dashboard) + '\n');
const lines = [];
const para = (s) => lines.push(s, '');
const table = (head, rows) => {
  lines.push('| ' + head.join(' | ') + ' |', '| ' + head.map(() => '---').join(' | ') + ' |');
  rows.forEach((r) => lines.push('| ' + r.join(' | ') + ' |'));
  lines.push('');
};
const fmt = (x, digits = 2) => Number.isFinite(x) ? x.toFixed(digits) : '—';
const models = { rules: 'Static rules', tree: 'LightGBM (full features)', cnn: 'Temporal 1D CNN', tree_levels_only: 'LightGBM (mean and latest)' };
para('# Four-week simulated desk study');
para('Aster, Birch and Cedar are fictional. The generator created 84 desk sessions of 45 minutes, dated ' +
  dashboard.start + ' through ' + end + '. Each profile has 26 symptom check-ins, one planned change and four labeled ten-minute visits. Movement, reported discomfort and adherence are simulated. The F1 scores, alert counts and inference timings below were computed by running the software.');
para('## Activity recognition');
para('Nine visits were used for model selection. The selected ' + models[benchmark.selected] +
  ' graph was fitted on eligible windows from those visits. The three architectures and the LightGBM feature ablation were then evaluated on three later visits. Each 20-second window predicts its final second. The alert replay requires 15 seconds of sustained predicted slouch and a two-minute cooldown.');
for (const [title, results] of [
  ['Held-out development sessions', benchmark.results.leave_one_session_out],
  ['Held-out participants', benchmark.results.leave_one_participant_out],
  ['Later visits reserved before training', benchmark.follow_up.models],
]) {
  para('### ' + title);
  table(['Model', 'Macro-F1', 'Scored hours', 'Alerts', 'False alerts', 'False alerts/hour', 'Native CPU p95 (ms)'],
    Object.entries(results).map(([k, s]) => [models[k], fmt(s.macro_f1, 3), fmt(s.evaluated_seconds/3600, 3), s.alerts,
      s.false_alerts, fmt(s.false_alerts_per_hour), fmt(s.p95_ms, 3)]));
}
para('### Train on one participant and test on another');
table(['Train', 'Test', 'Rules macro-F1', 'LightGBM full macro-F1', 'LightGBM mean/latest macro-F1', 'CNN macro-F1'],
  Object.entries(benchmark.single_participant_transfer).flatMap(([a, results]) => Object.entries(results)
    .map(([b, r]) => [a.slice(4), b.slice(4), ...['rules','tree','tree_levels_only','cnn'].map((k) => fmt(r[k].macro_f1, 3))])));
para('### Which activities were recognized on the later visits?');
table(['Model', ...labels], Object.entries(benchmark.follow_up.models).map(([k, s]) =>
  [models[k], ...labels.map((label) => fmt(s.class_f1[label], 3))]));
para('Native latency measures a warm ONNX graph with one CPU thread. It excludes feature preparation. The [complete benchmark](benchmark.json) includes confusion matrices, runtime version and fold counts. Small denominators and activity distributions affect these rates. A zero in the false-alert column applies only to the evaluated time.');
para('## Four-week replay');
para('All complete windows were scored with the same fitted model. The four-week replay includes its development visits. The forecaster at each instant could use only the current and earlier observations. Untracked seconds and missing check-ins remain missing. The simulated angle uses the ear–shoulder proxy. Direct tragus–C7 measurements require marked images.');
const allWeeks = [];
for (const name of diary.people) {
  for (const w of dashboard.reports[name.toLowerCase()][28].weeks) allWeeks.push([name, w.end, fmt(w.cva, 1),
    fmt(w.neutral_pct, 1), fmt(w.pain), w.completed, w.paired, fmt(w.r_cva), fmt(w.r_neutral)]);
}
table(['Profile', 'Week ending', 'Mean angle (°)', 'Neutral (%)', 'Discomfort (0–10)', 'Drills completed', 'Paired days', 'r angle/pain', 'r neutral/pain'], allWeeks);
para('### Before and after a recorded change');
table(['Profile', 'Change', 'Angle before → after (°)', 'Neutral before → after (%)', 'Discomfort before → after', 'Logged days before / after'],
  diary.people.map((name) => {
    const { title, before, after } = dashboard.reports[name.toLowerCase()][28].changes[0];
    const pair = (k) => fmt(before[k], 1) + ' → ' + fmt(after[k], 1);
    return [name, title, pair('cva'), pair('neutral_pct'), pair('pain'), before.logged_days + ' / ' + after.logged_days];
  }));
para('Both intervals cover seven calendar days. The change date starts follow-up. The generator specifies different symptom responses by profile and includes daily noise. These differences demonstrate the comparison and cannot establish a treatment effect.');
para('### Reminder timing');
table(['Profile', '30-minute timers', 'During neutral', 'During slouch', 'Forecast nudges', 'Complete 3-minute follow-ups', 'Followed by sustained slouch', 'Mean lead (s)'],
  diary.people.map((name) => {
    const k = name.toLowerCase(), t = dashboard.timers[k], f = dashboard.forecast[k];
    return [name, t.scheduled, t.during_neutral, t.during_slouch, f.issued, f.evaluable, f.followed_by_slouch,
      f.lead_seconds.length ? fmt(f.lead_seconds.reduce((a,b)=>a+b,0)/f.lead_seconds.length, 1) : '—'];
  }));
para('The timer comparison uses one blind prompt at minute 30. The personalized forecaster uses prior completed sessions, current classified observations and the app’s reminder cooldown. For scoring, a later event needs 15 consecutive seconds labeled slouch with at least 7° of angle loss. Lead is measured to the first second of that run. A complete follow-up requires three observed minutes. The simulated participant responds to the scheduled exercise and dismisses other alerts to preserve the trajectory. Real-world alert burden, generalization and symptom effects require observations from people.');
para('### Controlled forecast checks');
para('Two additional 45-minute scenarios start from the same four-week history for each profile. One holds a steady position. The other gradually increases forward displacement from minute 10 through minute 25, then sustains it for 20 minutes. The exported model classifies every window. These scenarios are engineering checks and are excluded from the four-week results.');
table(['Profile', 'Steady-session forecast nudges', 'Progressive-session forecast nudges', 'First 7° loss (min)', 'Advance notice within 3 min (s)'],
  diary.people.map((name) => {
    const { stable, progressive } = dashboard.controlled[name.toLowerCase()];
    return [name, stable.nudges.length, progressive.nudges.length, fmt(progressive.onset/60, 1), fmt(progressive.lead_seconds, 0)];
  }));
para('Reproduce the study or collect new data using the [research instructions](../README.md). Explore the records under **Trends → Data source** in the desktop app.');
await writeFile(join(dir, 'RESULTS.md'), lines.join('\n'));
console.log('Created the three local example dashboards and study results.');
