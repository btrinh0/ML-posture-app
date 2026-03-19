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
export class Insights {
  constructor(store) {
    this.s = store;
  }
  historicalSlope() {
    const s = this.s,
      session = s.session?.id ?? -1,
      now = s.now();
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
      slope: average(slopes),
    };
    return result;
  }
}
