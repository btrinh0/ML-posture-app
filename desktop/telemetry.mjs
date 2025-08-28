import { channelNames, drifting } from '../shared/kinematics.mjs';

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
  sample(payload) {
    const s = this.store.session;
    if (!s || !payload?.metrics) return false;
    if (this.session !== s.id) this.reset();
    const m = payload.metrics,
      side = m?.view === 'side';
    const now = this.store.now(),
      sec = Math.floor(now / 1000);
    const pred = null;
    this.freshAt = now;
    this.rate = [1, 12, 30].includes(payload.rate) ? payload.rate : 1;
    this.policy = payload.fixed === true ? 'fixed' : 'adaptive';
    this.last = m;
    if (sec === this.lastSecond) return false;
    this.lastSecond = sec;
    const label = null;
    const vector = null;
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
    return true;
  }
}
