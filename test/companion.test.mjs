import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeskStore } from '../desktop/store.mjs';
import { deskResult } from '../desktop/companion.mjs';

test('desk adjustments, symptoms and intervals belong to the selected profile', () => {
  const s = new DeskStore(':memory:');
  const answers = { screen: 2, reach: 0, seat: 1 };
  assert.equal(deskResult(answers).score, 1);
  s.saveSetup({ answers, interval: 25 });
  s.checkIn({ jaw: 0, neck: 3, back: 2 });
  s.checkIn({ jaw: 2, neck: 1, back: 0 });
  assert.equal(s.symptomsSince().length, 1);
  assert.equal(s.state().symptoms.jaw, 2);
  assert.throws(() => s.checkIn({ jaw: null, neck: 2, back: 1 }));
  s.addProfile('Sibling');
  assert.equal(s.state().symptoms, null);
  assert.equal(s.state().profile.setup, null);
  s.close();
});
test('idle and suspension do not advance reminders; retries resolve one prompt once', () => {
  let now = 1_800_000_000_000;
  const s = new DeskStore(':memory:', () => now);
  s.start();
  assert.throws(() => s.addProfile('Second'));
  for (let i = 0; i < 1800; i++) { now += 1000; s.tick(true); }
  now += 3_600_000; s.tick(false);
  assert.equal(s.session.active_ms, 0);
  for (let i = 0; i < 1800; i++) { now += 1000; s.tick(false); }
  const p = s.pending();
  assert.equal(p.kind, 'timer');
  s.tick(false);
  s.resolve(p.id, 'completed'); s.resolve(p.id, 'completed');
  assert.equal(s.state().completed, 1);
  s.close();
});
test('a restarted process closes interrupted sessions at the last checkpoint', () => {
  const dir = mkdtempSync(join(tmpdir(), 'deskframe-store-'));
  try {
    let now = Date.now(); const path = join(dir, 'desk.sqlite');
    const first = new DeskStore(path, () => now);
    first.start(); now += 5000; first.tick(false); first.prompt('timer','walk');
    first.db.close(); now += 60_000;
    const second = new DeskStore(path, () => now);
    const [entry] = second.state().history;
    assert.equal(entry.active_ms, 5000); assert.equal(entry.ended, now - 60_000);
    assert.equal(second.get('SELECT outcome FROM prompts').outcome, 'ended');
    second.close();
  } finally { rmSync(dir, { recursive: true }); }
});
