import test from 'node:test';
import assert from 'node:assert/strict';
import { WindowBuffer, rollingFeatures } from '../shared/windows.mjs';
const vector = (drop) => [drop, 0, 0, 0, 0, 0, 0, 0, 0, 0];
test('a window resets across missing seconds and rolling slopes use elapsed seconds', () => {
  const b = new WindowBuffer();
  for (let sec = 0; sec < 19; sec++) assert.equal(b.push(sec, vector(sec)), null);
  assert.equal(b.push(20, vector(20)), null);
  let ready;
  for (let sec = 21; sec <= 39; sec++) ready = b.push(sec, vector(sec));
  const f = rollingFeatures(ready);
  assert.equal(f.length, 42);
  assert.equal(f[20], 1);
  assert.equal(f.at(-1), 20);
  assert.equal(b.push(39, vector(39)), null);
});
