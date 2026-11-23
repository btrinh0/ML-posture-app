import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { _electron } from 'playwright-core';
import electron from 'electron';

const qa = resolve('.qa');
await mkdir(qa, { recursive: true });
const profile = await mkdtemp(join(qa, 'desktop-'));
const packaged = process.argv[2];
const client = await _electron.launch({
  executablePath: packaged || electron,
  args: [...(packaged ? [] : ['.']), '--user-data-dir=' + profile, '--tray', '--use-fake-device-for-media-stream'],
  timeout: 30_000,
});
try {
  const page = await client.firstWindow();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.getByRole('button', { name:'Desk setup', exact:true }).click();
  for (const [id, value] of [['screen','2'],['reach','0'],['seat','1']]) await page.locator('#' + id).selectOption(value);
  await page.getByRole('button', { name:'Save desk setup' }).click();
  await page.getByText('Raise the screen so you can read with your head comfortably upright.').waitFor();
  await page.getByRole('button', { name:'Study desk', exact:true }).click();
  await page.getByRole('button', { name:'Start session' }).click();
  await page.getByRole('button', { name:'End session' }).waitFor();
  assert.ok(await page.locator('#profiles').isDisabled());
  for (const [id, value] of [['jaw','0'],['neck','2'],['back','1']]) await page.locator('#' + id).selectOption(value);
  await page.getByRole('button', { name:'Save check-in' }).click();
  await page.getByText('Today’s check-in is saved.').waitFor();
  await page.getByRole('button', { name:'End session' }).click();
  await page.waitForFunction(() => document.querySelector('#history strong') !== null);
  const state = await page.evaluate(() => window.desk.state());
  assert.equal(state.history.length, 1); assert.equal(state.symptoms.neck, 2); assert.equal(state.setupResult.score, 1);
  await page.screenshot({ path:join(qa, 'study-desk.png') });
  assert.deepEqual(errors, []);
  console.log('Verified native session, desk scoring, daily check-in and SQLite history.');
} finally {
  await client.close();
  await rm(profile, { recursive:true, force:true, maxRetries:5, retryDelay:300 });
}
