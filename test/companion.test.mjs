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
