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
}
