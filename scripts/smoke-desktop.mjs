import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { cpus, release } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { resolve, join } from 'node:path';
import { _electron } from 'playwright-core';

const qa = resolve('.qa');
await mkdir(qa, { recursive: true });
const profile = await mkdtemp(join(qa, 'desktop-'));
const packaged = process.argv.slice(2).find(v => !v.startsWith('--'));
const fixtures = process.argv.slice(2).find(v => v.startsWith('--fixtures='))?.slice('--fixtures='.length);
const reference = process.argv.slice(2).find(v => v.startsWith('--pose-image='))?.slice('--pose-image='.length);
const client = await _electron.launch({
  executablePath: packaged ? resolve(packaged) : (await import('electron')).default,
  args: [...(packaged ? [] : ['.']), '--user-data-dir=' + profile, '--tray', '--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required'],
  timeout: 30_000,
});
try {
  const page = await client.firstWindow();
  page.setDefaultTimeout(20_000);
  await client.evaluate(({ powerMonitor })=>{ powerMonitor.getSystemIdleTime=()=>0; });
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
  if (reference) await page.locator('#view').selectOption('front');
  const pixels=reference ? (await readFile(reference)).toString('base64'):null;
  await page.evaluate(async pixels => {
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
    const ctx = canvas.getContext('2d');
    const source = new Image();
    if (pixels) { source.src='data:image/jpeg;base64,'+pixels; await source.decode(); }
    let frame = 0;
    const paint = () => {
      if (pixels) ctx.drawImage(source,source.width*.15,source.height*.12,source.width*.7,source.height*.79,0,0,640,480);
      else { ctx.fillStyle = frame++ % 2 ? '#ddd' : '#eee'; ctx.fillRect(0,0,640,480); }
    };
    paint(); const stream = canvas.captureStream(30); const timer = setInterval(paint,33);
    window.testTrack = stream.getVideoTracks()[0];
    window.testEndFrames = () => clearInterval(timer);
    Object.defineProperty(navigator.mediaDevices,'getUserMedia',{ value:async constraints => {
      if (constraints.audio !== false) throw new Error('Unexpected microphone request.');
      return stream;
    } });
  },pixels);
  await page.getByRole('button', { name:'Start camera' }).click();
  await page.waitForFunction(() => !document.querySelector('#recalibrate').disabled ||
    /unavailable|stopped|denied|disconnected|No camera/.test(document.querySelector('#sensor-message').textContent), null, { timeout:25_000 })
    .catch(async err => { throw new Error((await page.locator('#sensor-message').textContent())+' / '+err.message); });
  assert.ok(await page.locator('#recalibrate').isEnabled(), await page.locator('#sensor-message').textContent());
  if (reference) {
    await page.locator('#readings strong').first().waitFor({ timeout:40_000 }).catch(async err=>{
      throw new Error((await page.locator('#sensor-message').textContent())+' / '+err.message);
    });
    const summaries={};
    for (const policy of ['adaptive','fixed']) {
      await page.locator('#policy').selectOption(policy);
      await delay(4000);
      const metrics=()=>client.evaluate(({ app })=>{
        const p=app.getAppMetrics();
        return { cpu:p.reduce((n,v)=>n+v.cpu.percentCPUUsage,0),mb:p.reduce((n,v)=>n+v.memory.workingSetSize/1024,0) };
      });
      await metrics();
      const readings=[];
      for (let i=0;i<8;i++) { await delay(3000); readings.push(await metrics()); }
      summaries[policy]={ samples:readings.length,mean_cpu:readings.reduce((n,r)=>n+r.cpu,0)/readings.length,
        mean_working_set_mb:readings.reduce((n,r)=>n+r.mb,0)/readings.length };
    }
    const result={ cpu:cpus()[0].model,logical_processors:cpus().length,os:release(),seconds_per_mode:24,
      source:'Public MediaPipe pose.jpg, replayed at 640×480 in an active isolated profile; stable front-view reference.',summaries };
    await writeFile(join(qa,'edge-replay.json'),JSON.stringify(result,null,2));
    console.log('Measured reference replay:',JSON.stringify(result));
  }
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
  await page.getByRole('button',{ name:'Trends',exact:true }).click();
  await page.locator('#heat table').waitFor();
  await page.locator('#range').selectOption('7'); await page.locator('#plot-group').selectOption('daily');
  await page.locator('#weekly').evaluate(el=>el.closest('details').open=true);
  await page.waitForFunction(()=>document.querySelectorAll('#weekly tbody tr').length===1);
  assert.equal(await page.locator('#weekly tbody tr').count(),1);
  await page.screenshot({ path:join(qa,'trends.png') });
  await page.getByRole('button',{ name:'Study desk',exact:true }).click();
  await page.screenshot({ path:join(qa, 'study-desk.png') });
  if (fixtures) {
    const latency={};
    for (const kind of ['rules','tree','cnn']) {
      const bundle = JSON.parse(await readFile(join(fixtures,'fixture-'+kind+'.deskmodel'),'utf8'));
      const checks = JSON.parse(await readFile(join(fixtures,'parity-'+kind+'.json'),'utf8'));
      const actual = await page.evaluate(async ({ bundle, x }) => {
        const { openClassifier } = await import('./classifier.mjs');
        const model = await openClassifier(bundle,true);
        try {
          const results = [];
          for (const rows of x) results.push(bundle.labels.indexOf((await model.classify(rows)).label));
          const times=[];
          for (let i=0;i<100;i++) times.push((await model.classify(x[i%x.length])).latency);
          times.sort((a,b)=>a-b);
          return { results,p50_ms:times[49],p95_ms:times[94],mean_ms:times.reduce((a,b)=>a+b,0)/times.length };
        } finally { await model.close(); }
      }, { bundle, x:checks.x });
      assert.deepEqual(actual.results,checks.y,kind+' browser/Python predictions differ');
      const { results,...timing }=actual; latency[kind]=timing;
    }
    console.log('All three ONNX graphs matched Python CPU predictions inside the desktop WASM runtime.');
    await writeFile(join(qa,'onnx-replay.json'),JSON.stringify(latency,null,2));
    console.log('Warm desktop ONNX window timings (ms):',JSON.stringify(latency));
  }
  assert.deepEqual(errors, []);
  console.log('Verified native session, desk scoring, daily check-in and SQLite history.');
} finally {
  await client.close();
  await rm(profile, { recursive:true, force:true, maxRetries:5, retryDelay:300 });
}
