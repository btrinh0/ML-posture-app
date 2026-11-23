import { channelNames, labels, drifting } from '../shared/kinematics.mjs';

const finite = (v, bound) => Number.isFinite(v) && Math.abs(v) <= bound;
export class Telemetry {
  constructor(store) {
    this.store = store;
    store.db.exec(`
      CREATE TABLE IF NOT EXISTS samples (
        session INTEGER NOT NULL REFERENCES sessions, sec INTEGER NOT NULL, active_ms INTEGER NOT NULL,
        view TEXT NOT NULL, cva REAL, drop_deg REAL, forward REAL, shoulder REAL, asym REAL, moment REAL, load_lb REAL,
        neutral INTEGER NOT NULL, prediction TEXT, label TEXT, segment INTEGER NOT NULL, vector TEXT,
        PRIMARY KEY(session,sec));
      CREATE TABLE IF NOT EXISTS marker_samples (
        session INTEGER NOT NULL, sec INTEGER NOT NULL, cva REAL NOT NULL, shoulder REAL NOT NULL,
        PRIMARY KEY(session,sec), FOREIGN KEY(session,sec) REFERENCES samples(session,sec));
      CREATE TABLE IF NOT EXISTS performance (
        session INTEGER NOT NULL REFERENCES sessions, at INTEGER NOT NULL, policy TEXT NOT NULL,
        cpu REAL NOT NULL, ram_mb REAL NOT NULL, inference_ms REAL, rate INTEGER NOT NULL);
    `);
    this.reset();
  }
  reset() {
    this.session = this.store.session?.id;
    this.freshAt = null;
    this.label = null;
    this.collecting = false;
    this.lastSecond = null;
    this.segment = (this.segment ?? 0) + 1;
    this.policy = 'off';
    this.rate = 0;
    this.last = null;
    this.inference = null;
    this.recent = [];
    this.review = null;
  }
  fresh() {
    return (
      this.session === this.store.session?.id &&
      this.freshAt !== null &&
      this.store.now() - this.freshAt < 2500
    );
  }
  mark(value) {
    if (!this.collecting || !this.store.session || (value !== null && !labels.includes(value)))
      throw new Error('Enable labeled capture during a study session.');
    this.label = value;
    this.segment++;
  }
  collect(enabled) {
    if (enabled && !this.store.session) throw new Error('Start a study session first.');
    this.collecting = enabled === true;
    this.label = null;
    this.segment++;
    this.recent = [];
    this.review = null;
  }
  sample(payload) {
    const s = this.store.session;
    if (!s || s.id !== payload?.session || this.store.idle) return false;
    if (this.session !== s.id) this.reset();
    const m = payload.metrics,
      side = m?.view === 'side';
    if (!(side || m?.view === 'front')) return false;
    if (
      side &&
      (!finite(m.cva, 180) ||
        !finite(m.drop, 180) ||
        !finite(m.forward, 5) ||
        !finite(m.shoulder, 5) ||
        !finite(m.moment, 200) ||
        !finite(m.load, 500) ||
        !Array.isArray(m.vector) ||
        m.vector.length !== channelNames.length ||
        !m.vector.every((v) => finite(v, 360)))
    )
      return false;
    if (!side && !finite(m.asym, 180)) return false;
    const now = this.store.now(),
      sec = Math.floor(now / 1000);
    const pred = labels.includes(payload.prediction) ? payload.prediction : null;
    this.freshAt = now;
    this.rate = [1, 12, 30].includes(payload.rate) ? payload.rate : 1;
    this.policy = payload.fixed === true ? 'fixed' : 'adaptive';
    this.inference = finite(payload.latency, 60_000) ? payload.latency : null;
    this.last = m;
    if (sec === this.lastSecond) return false;
    this.lastSecond = sec;
    const label = this.collecting && side ? this.label : null;
    if (this.collecting && side) {
      this.recent = this.recent.filter((row) => row.sec > sec - 20);
      this.recent.push({ sec, vector: JSON.stringify(m.vector.map((v) => Number(v.toFixed(5)))) });
    }
    const vector = label ? JSON.stringify(m.vector.map((v) => Number(v.toFixed(5)))) : null;
    this.store.run(
      'INSERT OR IGNORE INTO samples VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      s.id,
      sec,
      s.active_ms,
      m.view,
      side ? m.cva : null,
      side ? m.drop : null,
      side ? m.forward : null,
      side ? m.shoulder : null,
      side ? null : m.asym,
      side ? m.moment : null,
      side ? m.load : null,
      Number(!drifting(m)),
      pred,
      label,
      this.segment,
      vector,
    );
    const marker = m.marker;
    if (side && finite(marker?.cva, 90) && marker.cva >= 0 && finite(marker.shoulder, 2))
      this.store.run('INSERT OR IGNORE INTO marker_samples VALUES(?,?,?,?)', s.id, sec, marker.cva, marker.shoulder);
    return true;
  }
  freezeCorrection(prompt) {
    if (prompt && this.collecting && this.recent.length)
      this.review = { id: prompt.id, rows: [...this.recent] };
  }
  correct(id, label) {
    if (
      !this.review ||
      id !== this.review.id ||
      !this.collecting ||
      !labels.includes(label) ||
      label === 'slouch'
    )
      throw new Error('No matching activity correction is available.');
    const segment = ++this.segment;
    for (const row of this.review.rows)
      this.store.run(
        'UPDATE samples SET label=?,segment=?,vector=? WHERE session=? AND sec=?',
        label,
        segment,
        row.vector,
        this.store.session.id,
        row.sec,
      );
    this.segment++;
  }
  recordPerformance(cpu, ram) {
    if (this.store.session)
      this.store.run(
        'INSERT INTO performance VALUES(?,?,?,?,?,?,?)',
        this.store.session.id,
        this.store.now(),
        this.policy,
        cpu,
        ram,
        this.fresh() ? this.inference : null,
        this.fresh() ? this.rate : 0,
      );
  }
  exportRows() {
    return this.store
      .all(
        `SELECT p.study_id AS participant,s.study_id AS session,
      t.sec-CAST(s.started/1000 AS INTEGER) AS second,t.segment,t.label,t.vector,
      EXISTS(SELECT 1 FROM prompts a WHERE a.session=s.id AND a.outcome='false_positive'
        AND t.sec BETWEEN CAST(a.at/1000 AS INTEGER)-19 AND CAST(a.at/1000 AS INTEGER)) AS overridden
      FROM samples t JOIN sessions s ON t.session=s.id JOIN profiles p ON s.profile=p.id
      WHERE p.id=? AND t.label IS NOT NULL AND t.vector IS NOT NULL ORDER BY s.id,t.sec`,
        this.store.profile,
      )
      .map((r) => ({ ...r, version: 1, vector: JSON.parse(r.vector) }));
  }
}
