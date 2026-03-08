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
const fixtures = process.argv
  .slice(2)
  .find((v) => v.startsWith('--fixtures='))
  ?.slice('--fixtures='.length);
const sideImage = process.argv.slice(2).find((v) => v.startsWith('--side-image='))?.slice('--side-image='.length);
const reference = sideImage || process.argv
  .slice(2)
  .find((v) => v.startsWith('--pose-image='))
  ?.slice('--pose-image='.length);
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
  await page.getByRole('button', { name: 'Pose sensor' }).click();
  if (reference) await page.locator('#view').selectOption(sideImage ? 'side' : 'front');
  const pixels = reference ? (await readFile(reference)).toString('base64') : null;
  await page.evaluate(async ({ pixels, side, mime }) => {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext('2d');
    const source = new Image();
    if (pixels) {
      source.src = 'data:' + mime + ';base64,' + pixels;
      await source.decode();
    }
    let frame = 0;
    const paint = () => {
      if (pixels && side) {
        const scale = Math.min(640 / source.width, 480 / source.height);
        ctx.fillStyle = '#eee';
        ctx.fillRect(0, 0, 640, 480);
        ctx.drawImage(source, (640 - source.width*scale)/2, (480 - source.height*scale)/2, source.width*scale, source.height*scale);
        if (window.testMarkers) {
          for (const [x, y, color] of [[.449, .109, '#00ebef'], [.417, .189, '#f208ec']]) {
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc((640-source.width*scale)/2 + x*source.width*scale,
              (480-source.height*scale)/2 + y*source.height*scale, 3.5, 0, 2*Math.PI);
            ctx.fill();
          }
        }
      } else if (pixels)
        ctx.drawImage(
          source,
          source.width * 0.15,
          source.height * 0.12,
          source.width * 0.7,
          source.height * 0.79,
          0,
          0,
          640,
          480,
        );
      else {
        ctx.fillStyle = frame++ % 2 ? '#ddd' : '#eee';
        ctx.fillRect(0, 0, 640, 480);
      }
    };
    paint();
    const stream = canvas.captureStream(30);
    const timer = setInterval(paint, 33);
    window.testTrack = stream.getVideoTracks()[0];
    window.testEndFrames = () => clearInterval(timer);
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      value: async (constraints) => {
        if (constraints.audio !== false) throw new Error('Unexpected microphone request.');
        return stream;
      },
    });
  }, { pixels, side: Boolean(sideImage), mime: reference?.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg' });
  await page.getByRole('button', { name: 'Start camera' }).click();
  await page
    .waitForFunction(
      () =>
        !document.querySelector('#recalibrate').disabled ||
        /unavailable|stopped|denied|disconnected|No camera/.test(
          document.querySelector('#sensor-message').textContent,
        ),
      null,
      { timeout: 25_000 },
    )
    .catch(async (err) => {
      throw new Error((await page.locator('#sensor-message').textContent()) + ' / ' + err.message);
    });
  assert.ok(
    await page.locator('#recalibrate').isEnabled(),
    await page.locator('#sensor-message').textContent(),
  );
  if (reference) {
    await page
      .locator('#readings strong')
      .first()
      .waitFor({ timeout: 40_000 })
      .catch(async (err) => {
        throw new Error((await page.locator('#sensor-message').textContent()) + ' / ' + err.message);
      });
  }
  await page.getByRole('button', { name: 'Stop camera' }).click();
  assert.equal(await page.locator('video').evaluate((v) => v.srcObject), null);
  assert.equal(
    await page.evaluate(() => {
      window.testEndFrames();
      return window.testTrack.readyState;
    }),
    'ended',
  );
  await page.getByRole('button', { name: 'Study desk', exact: true }).click();
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
  {
    const suites = [];
    if (fixtures) for (const kind of ['rules', 'tree', 'cnn']) {
      suites.push({ kind, bundle: JSON.parse(await readFile(join(fixtures, 'fixture-' + kind + '.deskmodel'), 'utf8')),
        ...JSON.parse(await readFile(join(fixtures, 'parity-' + kind + '.json'), 'utf8')) });
    }
    const latency = {};
    for (const { kind, bundle, x, y } of suites) {
      const actual = await page.evaluate(
        async ({ bundle, x }) => {
          const { openClassifier } = await import('./classifier.mjs');
          const model = await openClassifier(bundle, true);
          try {
            const results = [];
            for (const rows of x) results.push(bundle.labels.indexOf((await model.classify(rows)).label));
            const times = [];
            for (let i = 0; i < 100; i++) times.push((await model.classify(x[i % x.length])).latency);
            times.sort((a, b) => a - b);
            return {
              results,
              p50_ms: times[49],
              p95_ms: times[94],
              mean_ms: times.reduce((a, b) => a + b, 0) / times.length,
            };
          } finally {
            await model.close();
          }
        },
        { bundle, x },
      );
      assert.deepEqual(actual.results, y, kind + ' browser/Python predictions differ');
      const { results, ...timing } = actual;
      latency[kind] = timing;
    }
    console.log('Python and desktop CPU predictions matched for ' + suites.map((suite) => suite.kind).join(', ') + '.');
    await writeFile(join(qa, 'onnx-replay.json'), JSON.stringify(latency, null, 2));
    console.log('Warm desktop ONNX window timings (ms):', JSON.stringify(latency));
  }
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
