import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { dayBefore, deskResult, drills, localDay } from './companion.mjs';

export class DeskStore {
  constructor(path, clock = Date.now) {
    this.now = clock;
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS profiles (
        id INTEGER PRIMARY KEY, alias TEXT NOT NULL UNIQUE COLLATE NOCASE,
        study_id TEXT NOT NULL UNIQUE, interval_min INTEGER NOT NULL DEFAULT 30, setup TEXT);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY, profile INTEGER NOT NULL REFERENCES profiles, started INTEGER NOT NULL,
        ended INTEGER, last_tick INTEGER NOT NULL, active_ms INTEGER NOT NULL DEFAULT 0,
        next_break INTEGER NOT NULL, study_id TEXT NOT NULL UNIQUE);
      CREATE UNIQUE INDEX IF NOT EXISTS one_open_session ON sessions((1)) WHERE ended IS NULL;
      CREATE TABLE IF NOT EXISTS prompts (
        id INTEGER PRIMARY KEY, session INTEGER NOT NULL REFERENCES sessions, at INTEGER NOT NULL,
        kind TEXT NOT NULL, drill TEXT NOT NULL, outcome TEXT, resolved INTEGER);
      CREATE UNIQUE INDEX IF NOT EXISTS one_pending ON prompts(session) WHERE outcome IS NULL;
      CREATE TABLE IF NOT EXISTS symptoms (
        profile INTEGER NOT NULL REFERENCES profiles, day TEXT NOT NULL, jaw INTEGER NOT NULL,
        neck INTEGER NOT NULL, back INTEGER NOT NULL, PRIMARY KEY(profile, day));
    `);
    this.db
      .exec(`UPDATE prompts SET outcome='ended',resolved=(SELECT last_tick FROM sessions WHERE sessions.id=prompts.session)
      WHERE outcome IS NULL AND session IN (SELECT id FROM sessions WHERE ended IS NULL);
      UPDATE sessions SET ended=last_tick WHERE ended IS NULL;`);
    if (!this.get('SELECT id FROM profiles LIMIT 1')) this.addProfile('My desk');
    this.profile =
      Number(this.get("SELECT value FROM settings WHERE key='profile'")?.value) ||
      this.get('SELECT min(id) AS id FROM profiles').id;
    this.session = null;
    this.idle = false;
  }
  get(sql, ...args) {
    return this.db.prepare(sql).get(...args);
  }
  all(sql, ...args) {
    return this.db.prepare(sql).all(...args);
  }
  run(sql, ...args) {
    return this.db.prepare(sql).run(...args);
  }
  transaction(work) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }
  addProfile(alias) {
    if (typeof alias !== 'string' || !alias.trim() || alias.trim().length > 32)
      throw new Error('Use a profile name of 1–32 characters.');
    if (this.get('SELECT id FROM profiles WHERE alias=?', alias.trim()))
      throw new Error('That profile already exists.');
    const row = this.run('INSERT INTO profiles(alias,study_id) VALUES(?,?)', alias.trim(), randomUUID());
    this.chooseProfile(Number(row.lastInsertRowid));
  }
  chooseProfile(id) {
    if (!Number.isInteger(id) || !this.get('SELECT id FROM profiles WHERE id=?', id))
      throw new Error('Unknown profile.');
    this.run("INSERT OR REPLACE INTO settings VALUES('profile',?)", String(id));
    this.profile = id;
  }
  saveSetup({ answers, interval }) {
    deskResult(answers);
    if (![25, 30, 35, 40].includes(interval))
      throw new Error('Choose a break interval from 25 to 40 minutes.');
    this.run(
      'UPDATE profiles SET setup=?, interval_min=? WHERE id=?',
      JSON.stringify(answers),
      interval,
      this.profile,
    );
    if (this.session) {
      this.session.next_break = this.session.active_ms + interval * 60_000;
      this.persist();
    }
  }
  checkIn(values) {
    const scores = ['jaw', 'neck', 'back'].map((key) => values?.[key]);
    if (scores.some((v) => !Number.isInteger(v) || v < 0 || v > 10))
      throw new Error('Enter a score from 0 to 10 for each area.');
    this.run(
      'INSERT OR REPLACE INTO symptoms VALUES(?,?,?,?,?)',
      this.profile,
      localDay(this.now()),
      ...scores,
    );
  }
  start() {
    if (this.session) return;
    const now = this.now();
    const interval = this.get('SELECT interval_min FROM profiles WHERE id=?', this.profile).interval_min;
    this.run(
      'INSERT INTO sessions(profile,started,last_tick,next_break,study_id) VALUES(?,?,?,?,?)',
      this.profile,
      now,
      now,
      interval * 60_000,
      randomUUID(),
    );
    this.session = this.get('SELECT * FROM sessions WHERE ended IS NULL');
    this.idle = false;
    this.lastSaved = now;
  }
  persist() {
    const s = this.session;
    if (s)
      this.run(
        'UPDATE sessions SET active_ms=?,last_tick=?,next_break=? WHERE id=?',
        s.active_ms,
        s.last_tick,
        s.next_break,
        s.id,
      );
    this.lastSaved = this.now();
  }
  tick(idle, sensorActive = false, drill) {
    const s = this.session;
    if (!s) return;
    const now = this.now();
    const gap = now - s.last_tick;
    if (!idle && !this.idle && gap > 0 && gap <= 5000) s.active_ms += gap;
    s.last_tick = now;
    this.idle = idle;
    if (now - this.lastSaved >= 5000) this.persist();
    if (!idle && s.active_ms >= s.next_break && !this.pending()) {
      const count = this.get(
        'SELECT count(*) AS n FROM prompts p JOIN sessions s ON p.session=s.id WHERE s.profile=?',
        this.profile,
      ).n;
      return this.prompt('timer', drill ?? Object.keys(drills)[count % Object.keys(drills).length]);
    }
  }
  prompt(kind, drill) {
    const s = this.session;
    if (!s || this.idle || !Object.hasOwn(drills, drill) || this.pending()) return;
    const now = this.now();
    this.run('INSERT INTO prompts(session,at,kind,drill) VALUES(?,?,?,?)', s.id, now, kind, drill);
    return this.pending();
  }
  pending() {
    return (
      this.session &&
      this.get('SELECT id,kind,drill FROM prompts WHERE session=? AND outcome IS NULL', this.session.id)
    );
  }
  resolve(id, outcome, onResolve) {
    if (!['completed', 'snoozed', 'skipped'].includes(outcome))
      throw new Error('Unknown break response.');
    const pending = this.pending();
    if (!pending || pending.id !== id) return;
    this.transaction(() => {
      onResolve?.();
      this.run('UPDATE prompts SET outcome=?,resolved=? WHERE id=?', outcome, this.now(), id);
      const interval = this.get('SELECT interval_min FROM profiles WHERE id=?', this.profile).interval_min;
      this.session.next_break = this.session.active_ms + (outcome === 'snoozed' ? 5 : interval) * 60_000;
      this.persist();
    });
  }
  end() {
    if (!this.session) return;
    const s = this.session;
    this.transaction(() => {
      this.persist();
      this.run(
        "UPDATE prompts SET outcome='ended',resolved=? WHERE session=? AND outcome IS NULL",
        this.now(),
        s.id,
      );
      this.run('UPDATE sessions SET ended=? WHERE id=?', this.now(), s.id);
    });
    this.session = null;
    this.idle = false;
  }
  state() {
    const today = localDay(this.now());
    const profile = this.get('SELECT id,alias,interval_min,setup FROM profiles WHERE id=?', this.profile);
    profile.setup = profile.setup ? JSON.parse(profile.setup) : null;
    return {
      profile,
      profiles: this.all('SELECT id,alias FROM profiles ORDER BY id'),
      day: today,
      setupResult: profile.setup && deskResult(profile.setup),
      session: this.session && { ...this.session },
      idle: this.idle,
      prompt: this.pending() || null,
      symptoms:
        this.get('SELECT jaw,neck,back FROM symptoms WHERE profile=? AND day=?', this.profile, today) || null,
      history: this.all(
        'SELECT started,ended,active_ms FROM sessions WHERE profile=? AND ended IS NOT NULL ORDER BY id DESC LIMIT 5',
        this.profile,
      ),
    };
  }
  symptomsSince(days = 28) {
    return this.all(
      'SELECT day,jaw,neck,back FROM symptoms WHERE profile=? AND day>=? ORDER BY day',
      this.profile,
      dayBefore(localDay(this.now()), days - 1),
    );
  }
  close() {
    this.end();
    this.db.close();
  }
}
