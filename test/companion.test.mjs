import test from 'node:test';
import assert from 'node:assert/strict';
import { deskResult } from '../desktop/companion.mjs';

test('scores supported and unsupported desks, and catches missing answers', () => {
  assert.equal(deskResult({screen: 0, reach: 0, seat: 0}).score, 3);
  assert.equal(deskResult({screen: 1, reach: 2, seat: 1}).score, 0);
  assert.throws(() => deskResult({reach: 1, seat: 1}));
});
