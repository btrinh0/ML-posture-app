import { dayBefore, localDay } from './companion.mjs';

const average = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
const sum = (rows, key) => rows.reduce((n, r) => n + (r[key] ?? 0), 0);
export function slope(points) {
  if (points.length < 2) return null;
  const x = average(points.map((p) => p.minute)),
    y = average(points.map((p) => p.drop));
  const denom = points.reduce((n, p) => n + (p.minute - x) ** 2, 0);
  return denom ? points.reduce((n, p) => n + (p.minute - x) * (p.drop - y), 0) / denom : null;
}
function correlation(pairs) {
  if (pairs.length < 3) return null;
  const mx = average(pairs.map((p) => p[0])),
    my = average(pairs.map((p) => p[1]));
  const sx = pairs.reduce((s, [x]) => s + (x - mx) ** 2, 0),
    sy = pairs.reduce((s, [, y]) => s + (y - my) ** 2, 0);
  return sx && sy ? pairs.reduce((s, [x, y]) => s + (x - mx) * (y - my), 0) / Math.sqrt(sx * sy) : null;
}
const patterns = [
  { key: 'head', title: 'Forward head drift', drill: 'chin' },
  { key: 'protraction', title: 'Forward shoulder drift', drill: 'back' },
  { key: 'left', title: 'Left shoulder elevation', drill: 'shoulders' },
  { key: 'right', title: 'Right shoulder elevation', drill: 'shoulders' },
];
export class Insights {
  constructor(store) {
    this.s = store;
  }
  weeklyPattern() {
    const now = this.s.now(),
      key = this.s.profile;
    if (this.patternCache?.profile === key && now - this.patternCache.at < 60_000)
      return this.patternCache.value;
    const from = new Date(dayBefore(localDay(now), 6) + 'T00:00:00').getTime() / 1000;
    const totals = this.s.get(
      `SELECT sum(CASE WHEN drop_deg>=7 OR forward>=0.10 THEN 1 ELSE 0 END) AS head,
      sum(CASE WHEN shoulder>=0.08 THEN 1 ELSE 0 END) AS protraction,
      sum(CASE WHEN asym>=5 THEN 1 ELSE 0 END) AS left,sum(CASE WHEN asym<=-5 THEN 1 ELSE 0 END) AS right
      FROM samples t JOIN sessions s ON s.id=t.session WHERE s.profile=? AND t.sec>=?
      AND (prediction IS NULL OR prediction IN ('neutral','slouch'))`,
      key,
      from,
    );
    const best = patterns.toSorted((a, b) => totals[b.key] - totals[a.key])[0];
    const value = totals[best.key] >= 15 ? { ...best, seconds: totals[best.key] } : null;
    this.patternCache = { at: now, profile: key, value };
    return value;
  }
  historicalSlope() {
    const s = this.s,
      session = s.session?.id ?? -1,
      now = s.now();
    const key = s.profile + '-' + session;
    if (this.past?.key === key && now - this.past.at < 300_000) return this.past.result;
    const rows = s.all(
      `SELECT t.session, date(sec,'unixepoch','localtime') AS day,
      CAST(t.active_ms/60000 AS INTEGER) AS minute,avg(drop_deg) AS "drop" FROM samples t
      JOIN sessions s ON s.id=t.session WHERE s.profile=? AND s.ended IS NOT NULL AND t.view='side'
      AND (prediction IS NULL OR prediction IN ('neutral','slouch')) AND t.sec>=?
      GROUP BY t.session,day,minute HAVING count(*)>=10 ORDER BY t.session,minute`,
      s.profile,
      Math.floor(now / 1000) - 56 * 86400,
    );
    const series = Map.groupBy(rows, (p) => p.session);
    const slopes = [...series.values()]
      .filter((p) => p.length >= 8 && p.at(-1).minute - p[0].minute >= 9)
      .map(slope)
      .filter(Number.isFinite);
    const days = new Set(rows.map((p) => p.day)).size;
    const result = {
      days,
      sessions: slopes.length,
      slope: days >= 14 && slopes.length >= 3 ? average(slopes) : null,
    };
    this.past = { key, at: now, result };
    return result;
  }
  forecast() {
    const s = this.s,
      session = s.session;
    if (!session || session.active_ms < 10 * 60_000) return null;
    const personal = this.historicalSlope();
    if (personal.slope === null) return null;
    const points = s.all(
      `SELECT CAST(active_ms/60000 AS INTEGER) AS minute,avg(drop_deg) AS "drop"
      FROM samples WHERE session=? AND view='side' AND prediction IN ('neutral','slouch') AND active_ms>=?
      GROUP BY minute HAVING count(*)>=10 ORDER BY minute`,
      session.id,
      session.active_ms - 8 * 60_000,
    );
    const tail = points.slice(-6);
    if (tail.length < 6 || tail.at(-1).minute < Math.floor(session.active_ms / 60000) - 1 ||
        tail.at(-1).minute - tail[0].minute > 7 || tail.some((p,i) => i && p.minute - tail[i-1].minute > 2))
      return null;
    const recent = slope(tail.slice(-3)),
      prior = slope(tail.slice(0,3)),
      current = tail.at(-1).drop;
    const estimate = 0.75 * recent + 0.25 * personal.slope;
    if (recent <= 0 || recent <= prior || estimate <= 0 || current < 1 || current >= 7) return null;
    const minutes = (7 - current) / estimate;
    return minutes <= 3 ? { minutes, slope: estimate } : null;
  }
  sensorReminder(cue, metrics, prediction) {
    const s = this.s;
    if (!s.session || s.idle) return;
    let kind;
    if (cue) kind = 'drift';
    else if (metrics.view === 'side' && (prediction === 'neutral' || prediction === 'slouch') &&
        metrics.drop > 0 && metrics.drop < 7 &&
        (this.lastForecastSession !== s.session.id || s.now() - this.lastForecastAt >= 30_000)) {
      this.lastForecastSession = s.session.id;
      this.lastForecastAt = s.now();
      if (this.forecast()) kind = 'forecast';
    }
    if (kind) return s.prompt(kind, this.weeklyPattern()?.drill ?? (metrics.view === 'front' ? 'shoulders' : 'chin'));
  }
  changePeriod(first, last) {
    const s = this.s;
    const start = new Date(first + 'T00:00:00').getTime();
    const end = Math.min(s.now() + 1, new Date(dayBefore(last, -1) + 'T00:00:00').getTime());
    const tracking = s.get(
      `SELECT count(*) AS seconds, count(DISTINCT date(sec,'unixepoch','localtime')) AS tracked_days,
       avg(cva) AS cva, 100.0*avg(neutral) AS neutral_pct FROM samples t
       JOIN sessions s ON t.session=s.id WHERE s.profile=? AND t.view='side' AND sec>=? AND sec<?`,
      s.profile, start / 1000, end / 1000);
    const checkIns = s.get(
      `SELECT count(*) AS logged_days, avg(jaw) AS jaw, avg(neck) AS neck, avg(back) AS back,
       avg((jaw+neck+back)/3.0) AS pain FROM symptoms WHERE profile=? AND day BETWEEN ? AND ?`,
      s.profile, first, last < localDay(s.now()) ? last : localDay(s.now()));
    const { completed } = s.get(
      `SELECT count(*) AS completed FROM prompts p JOIN sessions s ON s.id=p.session
       WHERE s.profile=? AND p.outcome='completed' AND p.resolved>=? AND p.resolved<?`,
      s.profile, start, end);
    const marker = s.get(
      `SELECT avg(m.cva) AS marker_cva,count(*) AS marker_seconds FROM marker_samples m
       JOIN sessions s ON s.id=m.session WHERE s.profile=? AND m.sec>=? AND m.sec<?`,
      s.profile, start / 1000, end / 1000);
    return { first, last, ...tracking, ...marker, ...checkIns, completed };
  }
  changes(first, today) {
    return this.s.all(
      'SELECT day,title FROM interventions WHERE profile=? AND day BETWEEN ? AND ? ORDER BY day DESC,title',
      this.s.profile, dayBefore(first, 6), today,
    ).map((change) => {
      const before = this.changePeriod(dayBefore(change.day, 7), dayBefore(change.day, 1));
      const after = this.changePeriod(change.day, dayBefore(change.day, -6));
      return { ...change, before, after, inProgress: today <= after.last };
    });
  }
  report(days = 28) {
    const s = this.s,
      now = s.now(),
      today = localDay(now);
    if (![7, 28, 84].includes(days)) throw new Error('Unsupported trend range.');
    const first = dayBefore(today, days - 1),
      from = new Date(first + 'T00:00:00').getTime() / 1000;
    const profile = s.profile;
    const daily = s.all(
      `SELECT date(sec,'unixepoch','localtime') AS day,count(*) AS seconds,sum(cva) AS cva_sum,
      sum(neutral) AS neutral FROM samples t JOIN sessions s ON s.id=t.session
      WHERE s.profile=? AND t.sec>=? AND view='side' GROUP BY day ORDER BY day`,
      profile,
      from,
    );
    const symptoms = new Map(s.symptomsSince(days).map((r) => [r.day, r]));
    const markers = new Map(s.all(
      `SELECT date(m.sec,'unixepoch','localtime') AS day,count(*) AS n,sum(m.cva) AS total
       FROM marker_samples m JOIN sessions s ON s.id=m.session WHERE s.profile=? AND m.sec>=? GROUP BY day`,
      profile, from).map((row) => [row.day, row]));
    const observed = new Map(daily.map((d) => [d.day, d]));
    const completed = new Map(
      s
        .all(
          `SELECT date(p.resolved/1000,'unixepoch','localtime') AS day,count(*) AS n FROM prompts p
      JOIN sessions s ON s.id=p.session WHERE s.profile=? AND p.outcome='completed' AND p.resolved>=? GROUP BY day`,
          profile,
          from * 1000,
        )
        .map((r) => [r.day, r.n]),
    );
    const series = Array.from({ length: days }, (_, i) => {
      const day = dayBefore(today, days - i - 1),
        r = observed.get(day),
        p = symptoms.get(day);
      return {
        day,
        seconds: r?.seconds ?? 0,
        cva_sum: r?.cva_sum ?? 0,
        neutral: r?.neutral ?? 0,
        cva: r ? r.cva_sum / r.seconds : null,
        marker_seconds: markers.get(day)?.n ?? 0,
        marker_sum: markers.get(day)?.total ?? 0,
        marker_cva: markers.has(day) ? markers.get(day).total / markers.get(day).n : null,
        neutral_pct: r ? (100 * r.neutral) / r.seconds : null,
        pain: p ? (p.jaw + p.neck + p.back) / 3 : null,
        jaw: p?.jaw ?? null,
        neck: p?.neck ?? null,
        back: p?.back ?? null,
        completed: completed.get(day) ?? 0,
      };
    });
    const weeks = [];
    for (let i = 0; i < days; i += 7) {
      const week = series.slice(i, i + 7),
        seconds = sum(week, 'seconds');
      const pairs = week.filter((d) => d.cva !== null && d.pain !== null);
      const markerPairs = week.filter((d) => d.marker_cva !== null && d.pain !== null);
      const cva = seconds ? sum(week, 'cva_sum') / seconds : null;
      const markerSeconds = sum(week, 'marker_seconds');
      const markerCva = markerSeconds ? sum(week, 'marker_sum') / markerSeconds : null;
      const pain = average(week.map((d) => d.pain).filter(Number.isFinite)),
        prev = weeks.at(-1);
      weeks.push({
        start: week[0].day,
        end: week.at(-1).day,
        seconds,
        cva,
        marker_cva: markerCva,
        marker_change: markerCva !== null && prev?.marker_cva != null ? markerCva - prev.marker_cva : null,
        marker_seconds: markerSeconds,
        marker_paired: markerPairs.length,
        r_marker: correlation(markerPairs.map((d) => [d.marker_cva, d.pain])),
        pain,
        completed: sum(week, 'completed'),
        ...Object.fromEntries(
          ['jaw', 'neck', 'back'].map((k) => [k, average(week.map((d) => d[k]).filter(Number.isFinite))]),
        ),
        cva_change: cva !== null && prev?.cva != null ? cva - prev.cva : null,
        pain_change: pain !== null && prev?.pain != null ? pain - prev.pain : null,
        neutral_pct: seconds ? (100 * sum(week, 'neutral')) / seconds : null,
        paired: pairs.length,
        r_cva: correlation(pairs.map((d) => [d.cva, d.pain])),
        r_neutral: correlation(pairs.map((d) => [d.neutral_pct, d.pain])),
      });
    }
    const heat = [];
    const performance = [];
    const prompts = s.all(
      `SELECT kind,coalesce(outcome,'pending') AS outcome,count(*) AS n FROM prompts p
      JOIN sessions s ON s.id=p.session WHERE s.profile=? AND p.at>=? GROUP BY kind,outcome`,
      profile,
      from * 1000,
    );
    const forecastHeat = [];
    return {
      weeks,
      series,
      changes: this.changes(first, today),
      heat,
      forecastHeat,
      performance,
      prompts,
      pattern: this.weeklyPattern(),
      history: this.historicalSlope(),
    };
  }
}
