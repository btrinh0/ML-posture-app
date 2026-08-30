import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { DeskStore } from '../desktop/store.mjs';
import { Insights } from '../desktop/insights.mjs';
import { Telemetry } from '../desktop/telemetry.mjs';
import { DriftGate, drifting, labels } from '../shared/kinematics.mjs';

if (process.argv.includes('--help')) {
  console.log([
    'npm run study:report -- [study-directory]',
    '',
    'Rebuild the example with Python 3.13 and Node.js 24',
    'python -m pip install -r research/requirements.txt',
    'python research/generate_study.py --out study-data/example',
    'python research/benchmark.py study-data/example/aster-labels.jsonl.gz study-data/example/birch-labels.jsonl.gz study-data/example/cedar-labels.jsonl.gz --out study-data/example',
    'python research/generate_study.py --out study-data/example --replay-model study-data/example/activity.deskmodel',
    'node scripts/study-summary.mjs study-data/example',
  ].join('\n'));
  process.exit(0);
}

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

// Future labels are used only to score a nudge.
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
    // Start the next control from the same session history.
    for (const tbl of ['prompts','samples']) s.run('DELETE FROM ' + tbl + ' WHERE session=?', id);
    s.run('DELETE FROM sessions WHERE id=?', id);
  }
  s.close();
}
await writeFile(join(dir, 'dashboard.json'), JSON.stringify(dashboard) + '\n');
console.log(`Saved dashboard.json for ${diary.people.length} fictional profiles (${dashboard.start} to ${end}).`);
const heldOut = benchmark.follow_up?.models?.[benchmark.selected];
if (heldOut) {
  console.log([
    benchmark.selected,
    `macro-F1 ${heldOut.macro_f1.toFixed(3)}`,
    `${heldOut.false_alerts_per_hour.toFixed(2)} false alerts/h`,
    `p95 ${heldOut.p95_ms.toFixed(2)} ms`,
  ].join(' · '));
}
