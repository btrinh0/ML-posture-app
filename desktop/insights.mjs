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
    if (
      points.length < 6 ||
      points.at(-1).minute < Math.floor(session.active_ms / 60000) - 1 ||
      points.at(-1).minute - points.at(-6).minute !== 5
    )
      return null;
    const recent = slope(points.slice(-3)),
      prior = slope(points.slice(-6, -3)),
      current = points.at(-1).drop;
    const estimate = 0.75 * recent + 0.25 * personal.slope;
    if (recent <= 0 || recent <= prior || estimate <= 0 || current < 1 || current >= 7) return null;
    const minutes = (7 - current) / estimate;
    return minutes <= 3 ? { minutes, slope: estimate } : null;
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
      const cva = seconds ? sum(week, 'cva_sum') / seconds : null;
      const pain = average(week.map((d) => d.pain).filter(Number.isFinite)),
        prev = weeks.at(-1);
      weeks.push({
        start: week[0].day,
        end: week.at(-1).day,
        seconds,
        cva,
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
    const heat = s.all(
      `SELECT CAST(strftime('%w',sec,'unixepoch','localtime') AS INTEGER) AS weekday,
      CAST(strftime('%H',sec,'unixepoch','localtime') AS INTEGER)/4 AS block,
      count(*) AS seconds,100.0*sum(CASE WHEN drop_deg>=7 THEN 1 ELSE 0 END)/count(*) AS drift
      FROM samples t JOIN sessions s ON s.id=t.session WHERE s.profile=? AND view='side' AND sec>=?
      GROUP BY weekday,block`,
      profile,
      from,
    );
    const performance = s.all(
      `SELECT policy,count(*) AS n,avg(cpu) AS cpu,avg(ram_mb) AS ram,avg(inference_ms) AS latency
      FROM performance p JOIN sessions s ON s.id=p.session WHERE s.profile=? AND p.at>=? GROUP BY policy`,
      profile,
      from * 1000,
    );
    const prompts = s.all(
      `SELECT kind,coalesce(outcome,'pending') AS outcome,count(*) AS n FROM prompts p
      JOIN sessions s ON s.id=p.session WHERE s.profile=? AND p.at>=? GROUP BY kind,outcome`,
      profile,
      from * 1000,
    );
    const forecastHeat = s.all(
      `SELECT CAST(strftime('%w',p.at/1000,'unixepoch','localtime') AS INTEGER) AS weekday,
      CAST(strftime('%H',p.at/1000,'unixepoch','localtime') AS INTEGER)/4 AS block,count(*) AS n
      FROM prompts p JOIN sessions s ON s.id=p.session WHERE s.profile=? AND p.kind='forecast' AND p.at>=?
      GROUP BY weekday,block`,
      profile,
      from * 1000,
    );
    return {
      weeks,
      series,
      heat,
      forecastHeat,
      performance,
      prompts,
      pattern: this.weeklyPattern(),
      history: this.historicalSlope(),
    };
  }
}
