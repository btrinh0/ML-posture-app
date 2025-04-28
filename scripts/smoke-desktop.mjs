import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { cpus, release } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { resolve, join } from 'node:path';
import { _electron } from 'playwright-core';

const qa = resolve('.qa');
await mkdir(qa, { recursive: true });
const profile = await mkdtemp(join(qa, 'desktop-'));
const packaged = null;
const client = await _electron.launch({
  executablePath: (await import('electron')).default,
  args: [
    '.',
    '--user-data-dir=' + profile,
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
  ],
  timeout: 30_000,
});
try {
  const page = await client.firstWindow();
  page.setDefaultTimeout(20_000);
  await client.evaluate(({ powerMonitor }) => {
    powerMonitor.getSystemIdleTime = () => 0;
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.error(msg.text());
  });
  await page.getByRole('button', { name: 'Desk setup', exact: true }).click();
  for (const [id, value] of [
    ['screen', '2'],
    ['reach', '0'],
    ['seat', '1'],
  ])
    await page.locator('#' + id).selectOption(value);
  await page.getByRole('button', { name: 'Save desk setup' }).click();
  await page.getByText('Raise the screen so you can read with your head comfortably upright.').waitFor();
  await page.getByRole('button', { name: 'Study desk', exact: true }).click();
  await page.getByRole('button', { name: 'Start session' }).click();
  await page.getByRole('button', { name: 'End session' }).waitFor();
  assert.ok(await page.locator('#profiles').isDisabled());
  for (const [id, value] of [
    ['jaw', '0'],
    ['neck', '2'],
    ['back', '1'],
  ])
    await page.locator('#' + id).selectOption(value);
  await page.getByRole('button', { name: 'Save check-in' }).click();
  await page.getByText('Today’s check-in is saved.').waitFor();
  await page.getByRole('button', { name: 'End session' }).click();
  await page.waitForFunction(() => document.querySelector('#history strong') !== null);
  const state = await page.evaluate(() => window.desk.state());
  assert.equal(state.history.length, 1);
  assert.equal(state.symptoms.neck, 2);
  assert.equal(state.setupResult.score, 1);
  assert.deepEqual(errors, []);
  await client.close();
  const restarted = await _electron.launch({
    executablePath: packaged ? resolve(packaged) : (await import('electron')).default,
    args: [...(packaged ? [] : ['.']), '--user-data-dir=' + profile] });
  try {
    const home = await restarted.firstWindow();
    await home.waitForFunction(async () => (await window.desk.state()).history.length === 1);
    assert.equal((await home.evaluate(() => window.desk.state())).symptoms.neck, 2);
  } finally { await restarted.close(); }
  console.log('Reopened the saved check-in and study block.');
} finally {
  await client.close();
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
