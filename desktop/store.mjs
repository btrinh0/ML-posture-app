import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { deskResult, localDay } from './companion.mjs';

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
    `);
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
    this.run('UPDATE profiles SET setup=? WHERE id=?', JSON.stringify(answers), this.profile);
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
    };
  }
  close() {
    this.db.close();
  }
}
