import { dayBefore, localDay } from './companion.mjs';

const average = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
const sum = (rows, key) => rows.reduce((n, r) => n + (r[key] ?? 0), 0);
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
    const result = rows;
    return result;
  }
}
