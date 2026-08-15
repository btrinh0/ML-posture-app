import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeskStore } from '../desktop/store.mjs';
import { Telemetry } from '../desktop/telemetry.mjs';

test('an existing camera-free database keeps its profile, check-in and finished block on upgrade', () => {
  const dir = mkdtempSync(join(tmpdir(), 'deskframe-upgrade-'));
  const file = join(dir, 'desk.sqlite');
  try {
    const old = new DatabaseSync(file);
    old.exec(`CREATE TABLE profiles(id INTEGER PRIMARY KEY,alias TEXT UNIQUE,study_id TEXT UNIQUE,interval_min INTEGER DEFAULT 30,setup TEXT);
      CREATE TABLE sessions(id INTEGER PRIMARY KEY,profile INTEGER REFERENCES profiles,started INTEGER,ended INTEGER,last_tick INTEGER,active_ms INTEGER,next_break INTEGER,study_id TEXT UNIQUE);
      CREATE TABLE symptoms(profile INTEGER REFERENCES profiles,day TEXT,jaw INTEGER,neck INTEGER,back INTEGER,PRIMARY KEY(profile,day));
      INSERT INTO profiles VALUES(1,'Existing desk','desk-a',30,NULL);
      INSERT INTO sessions VALUES(1,1,1000,62000,62000,60000,1800000,'visit-a');
      INSERT INTO symptoms VALUES(1,'2025-05-04',0,2,3);`);
    old.close();
    const db = new DeskStore(file);
    try {
      new Telemetry(db);
      assert.equal(db.state().profile.alias,'Existing desk');
      assert.equal(db.state().history[0].active_ms,60000);
      assert.equal(db.get("SELECT neck FROM symptoms WHERE day='2025-05-04'").neck,2);
      assert.equal(db.get('SELECT count(*) AS n FROM samples').n,0);
      assert.deepEqual(db.all('PRAGMA foreign_key_check'),[]);
    } finally { db.close(); }
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
