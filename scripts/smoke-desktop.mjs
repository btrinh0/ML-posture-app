import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { _electron } from 'playwright-core';
import electron from 'electron';

const qa = resolve('.qa');
await mkdir(qa, { recursive: true });
const profile = await mkdtemp(join(qa, 'desktop-'));
const packaged = process.argv.slice(2).find(v => !v.startsWith('--'));
const fixtures = process.argv.slice(2).find(v => v.startsWith('--fixtures='))?.slice('--fixtures='.length);
const client = await _electron.launch({
  executablePath: packaged || electron,
  args: [...(packaged ? [] : ['.']), '--user-data-dir=' + profile, '--tray', '--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required'],
  timeout: 30_000,
});
try {
  const page = await client.firstWindow();
  page.setDefaultTimeout(20_000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', msg => { if (msg.type() === 'error') console.error(msg.text()); });
  await page.getByRole('button', { name:'Desk setup', exact:true }).click();
  for (const [id, value] of [['screen','2'],['reach','0'],['seat','1']]) await page.locator('#' + id).selectOption(value);
  await page.getByRole('button', { name:'Save desk setup' }).click();
  await page.getByText('Raise the screen so you can read with your head comfortably upright.').waitFor();
  await page.getByRole('button', { name:'Study desk', exact:true }).click();
  await page.getByRole('button', { name:'Start session' }).click();
  await page.getByRole('button', { name:'End session' }).waitFor();
  assert.ok(await page.locator('#profiles').isDisabled());
  await page.getByRole('button', { name:'Pose sensor' }).click();
  // Feed deterministic, memory-only frames through the real video element and MediaPipe runtime.
  await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
    const ctx = canvas.getContext('2d');
    let frame = 0;
    const paint = () => { ctx.fillStyle = frame++ % 2 ? '#ddd' : '#eee'; ctx.fillRect(0,0,640,480); };
    paint(); const stream = canvas.captureStream(12); const timer = setInterval(paint,90);
    window.testTrack = stream.getVideoTracks()[0];
    window.testEndFrames = () => clearInterval(timer);
    Object.defineProperty(navigator.mediaDevices,'getUserMedia',{ value:async constraints => {
      if (constraints.audio !== false) throw new Error('Unexpected microphone request.');
      return stream;
    } });
  });
  await page.getByRole('button', { name:'Start camera' }).click();
  await page.waitForFunction(() => !document.querySelector('#recalibrate').disabled ||
    /unavailable|stopped|denied|disconnected|No camera/.test(document.querySelector('#sensor-message').textContent), null, { timeout:25_000 })
    .catch(async err => { throw new Error((await page.locator('#sensor-message').textContent())+' / '+err.message); });
  assert.ok(await page.locator('#recalibrate').isEnabled(), await page.locator('#sensor-message').textContent());
  await page.getByRole('button', { name:'Stop camera' }).click();
  assert.equal(await page.locator('video').evaluate(v => v.srcObject), null);
  assert.equal(await page.evaluate(() => { window.testEndFrames(); return window.testTrack.readyState; }), 'ended');
  await page.getByRole('button', { name:'Study desk', exact:true }).click();
  for (const [id, value] of [['jaw','0'],['neck','2'],['back','1']]) await page.locator('#' + id).selectOption(value);
  await page.getByRole('button', { name:'Save check-in' }).click();
  await page.getByText('Today’s check-in is saved.').waitFor();
  await page.getByRole('button', { name:'End session' }).click();
  await page.waitForFunction(() => document.querySelector('#history strong') !== null);
  const state = await page.evaluate(() => window.desk.state());
  assert.equal(state.history.length, 1); assert.equal(state.symptoms.neck, 2); assert.equal(state.setupResult.score, 1);
  await page.screenshot({ path:join(qa, 'study-desk.png') });
  if (fixtures) {
    for (const kind of ['rules','tree','cnn']) {
      const bundle = JSON.parse(await readFile(join(fixtures,'fixture-'+kind+'.deskmodel'),'utf8'));
      const checks = JSON.parse(await readFile(join(fixtures,'parity-'+kind+'.json'),'utf8'));
      const actual = await page.evaluate(async ({ bundle, x }) => {
        const { openClassifier } = await import('./classifier.mjs');
        const model = await openClassifier(bundle,true);
        try {
          const results = [];
          for (const rows of x) results.push(bundle.labels.indexOf((await model.classify(rows)).label));
          return results;
        } finally { await model.close(); }
      }, { bundle, x:checks.x });
      assert.deepEqual(actual,checks.y,kind+' browser/Python predictions differ');
    }
    console.log('All three ONNX graphs matched Python CPU predictions inside the desktop WASM runtime.');
  }
  assert.deepEqual(errors, []);
  console.log('Verified native session, desk scoring, daily check-in and SQLite history.');
} finally {
  await client.close();
  await rm(profile, { recursive:true, force:true, maxRetries:5, retryDelay:300 });
}
