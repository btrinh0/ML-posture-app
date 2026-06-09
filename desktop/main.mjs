import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  Notification,
  powerMonitor,
  protocol,
  session,
  Tray,
  nativeImage,
} from 'electron';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DeskStore } from './store.mjs';
import { drills } from './companion.mjs';
import { Telemetry } from './telemetry.mjs';
import { labels } from '../shared/kinematics.mjs';
import { validateBundle } from '../shared/model-format.mjs';
import { Insights } from './insights.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, '../dist');
const home = 'desk://app/index.html';
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'desk',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
]);
app.setName('Deskframe');
app.setAppUserModelId('org.deskframe.companion');
let win,
  tray,
  store,
  telemetry,
  insights,
  timer,
  quitting = false,
  locked = false,
  shortcutsReady = false;
let lastPerformance = 0,
  candidate = null;
const isHome = (url) => url === home;
const state = () => ({
  ...store.state(),
  sensorFresh: telemetry.fresh(),
  collecting: telemetry.collecting,
  label: telemetry.label,
  shortcutsReady,
});
const show = () => {
  win?.show();
  win?.focus();
};
const send = () => {
  if (win && !win.isDestroyed()) win.webContents.send('desk:change', state());
};
function notify(prompt) {
  if (!prompt || !Notification.isSupported()) return;
  const note = new Notification({
    title: 'Time for a movement break',
    body: drills[prompt.drill].title,
    silent: true,
    icon: join(dist, 'assets/icon.png'),
  });
  note.on('click', () => {
    show();
    win?.webContents.send('desk:showPrompt');
  });
  note.show();
}
function tick() {
  if (!store.session) return;
  const idle = locked || powerMonitor.getSystemIdleTime() >= 60;
  notify(store.tick(idle, telemetry.fresh(), insights.weeklyPattern()?.drill));
  send();
}
function setCapture(enabled) {
  telemetry.collect(enabled);
  globalShortcut.unregisterAll();
  shortcutsReady = false;
  if (!enabled) return;
  shortcutsReady = labels
    .map((label, i) =>
      globalShortcut.register('CommandOrControl+Alt+' + (i + 1), () => {
        telemetry.mark(label);
        send();
      }),
    )
    .every(Boolean);
}
async function exportLabels() {
  const rows = telemetry.exportRows();
  if (!rows.length) throw new Error('This profile has no labeled side-view samples to export.');
  const file = await dialog.showSaveDialog(win, {
    title: 'Export this profile’s labeled measurements',
    defaultPath: 'desk-study.jsonl',
    filters: [{ name: 'Study data', extensions: ['jsonl'] }],
  });
  if (!file.canceled) await writeFile(file.filePath, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
}
const actions = {
  start: () => {
    if (!store.session) {
      store.start();
      telemetry.reset();
    }
  },
  end: () => {
    setCapture(false);
    store.end();
    telemetry.reset();
  },
  setup: (v) => store.saveSetup(v),
  checkIn: (v) => store.checkIn(v),
  markChange: (v) => store.markChange(v),
  resolve: (v) => {
    store.resolve(v.id, v.outcome);
  },
  addProfile: (v) => store.addProfile(v),
  profile: (v) => store.chooseProfile(v),
  capture: (v) => setCapture(v === true),
  label: (v) => telemetry.mark(v),
  exportLabels,
  sensorOff: () => {
    setCapture(false);
    telemetry.reset();
  },
  recalibrate: (v) => {
    setCapture(false);
    telemetry.reset();
    telemetry.policy = v === 'fixed' ? 'fixed' : 'adaptive';
  },
  lost: () => {
    telemetry.freshAt = null;
    telemetry.segment++;
  },
  sensorPolicy: (v) => {
    if (store.session) telemetry.policy = v === 'fixed' ? 'fixed' : 'adaptive';
  },
  installModel: () => {
    if (!candidate) throw new Error('Select and verify a model first.');
    store.run("INSERT OR REPLACE INTO settings VALUES('model',?)", JSON.stringify(candidate));
    candidate = null;
  },
  removeModel: () => {
    store.run("INSERT OR REPLACE INTO settings VALUES('model','null')");
    candidate = null;
  },
};
const mime = {
  '.html': 'text/html',
  '.mjs': 'text/javascript',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain',
  '.json': 'application/json',
};
const csp =
  "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; media-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
async function start() {
  protocol.handle('desk', async (request) => {
    const url = new URL(request.url);
    if (url.host !== 'app' || request.method !== 'GET') return new Response(null, { status: 403 });
    const path = resolve(dist, '.' + decodeURIComponent(url.pathname));
    if (!path.startsWith(dist + sep)) return new Response(null, { status: 404 });
    try {
      return new Response(await readFile(path), {
        headers: {
          'Content-Type': mime[extname(path)] || 'application/octet-stream',
          'Content-Security-Policy': csp,
          'X-Content-Type-Options': 'nosniff',
        },
      });
    } catch {
      return new Response(null, { status: 404 });
    }
  });
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
    (_d, cb) => cb({ cancel: true }),
  );
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb, details) => {
    cb(
      wc === win?.webContents &&
        isHome(wc.getURL()) &&
        permission === 'media' &&
        details.mediaTypes?.length === 1 &&
        details.mediaTypes[0] === 'video',
    );
  });
  session.defaultSession.setPermissionCheckHandler(
    (wc, permission, origin, details) =>
      wc === win?.webContents &&
      ['desk://app', 'desk://app/', home].includes(origin) &&
      permission === 'media' &&
      details.mediaType !== 'audio',
  );
  store = new DeskStore(join(app.getPath('userData'), 'deskframe.sqlite'));
  telemetry = new Telemetry(store);
  insights = new Insights(store);
  win = new BrowserWindow({
    width: 1120,
    height: 840,
    minWidth: 750,
    minHeight: 580,
    show: false,
    title: 'Deskframe',
    backgroundColor: '#faf9f6',
    icon: join(dist, 'assets/icon.png'),
    webPreferences: {
      preload: join(here, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  Menu.setApplicationMenu(null);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => {
    if (!isHome(url)) e.preventDefault();
  });
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      win.hide();
    }
  });
  ipcMain.handle('desk:state', (e) => {
    if (isHome(e.senderFrame.url)) return state();
  });
  ipcMain.handle('desk:report', (e, days) => {
    if (isHome(e.senderFrame.url)) return insights.report(days);
  });
  ipcMain.handle('desk:model', async (e, pick) => {
    if (!isHome(e.senderFrame.url)) return null;
    if (!pick) {
      const saved = store.get("SELECT value FROM settings WHERE key='model'");
      if (saved) return JSON.parse(saved.value);
      return null;
    }
    candidate = null;
    const file = await dialog.showOpenDialog(win, {
      title: 'Choose the benchmarked model',
      properties: ['openFile'],
      filters: [{ name: 'Deskframe activity model', extensions: ['deskmodel'] }],
    });
    if (file.canceled) return null;
    if ((await stat(file.filePaths[0])).size > 9 * 1024 * 1024)
      throw new Error('The model file exceeds 9 MB.');
    candidate = validateBundle(JSON.parse(await readFile(file.filePaths[0], 'utf8')));
    return candidate;
  });
  ipcMain.handle('desk:sample', (e, value) => {
    if (!isHome(e.senderFrame.url) || !telemetry.sample(value)) return;
    const p = insights.sensorReminder(value.cue === true, value.metrics, value.prediction);
    notify(p);
  });
  ipcMain.handle('desk:action', async (e, name, value) => {
    if (!isHome(e.senderFrame.url) || !Object.hasOwn(actions, name)) throw new Error('Unknown action.');
    await actions[name](value);
    send();
    return state();
  });
  tray = new Tray(
    nativeImage.createFromPath(join(dist, 'assets/icon.png')).resize({ width: 32, height: 32 }),
  );
  tray.setToolTip('Deskframe • Study companion');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Deskframe', click: show },
      { type: 'separator' },
      { label: 'Quit Deskframe', click: () => app.quit() },
    ]),
  );
  tray.on('click', show);
  for (const key of ['lock-screen', 'suspend'])
    powerMonitor.on(key, () => {
      locked = true;
      tick();
    });
  for (const key of ['unlock-screen', 'resume'])
    powerMonitor.on(key, () => {
      locked = false;
      tick();
    });
  await win.loadURL(home);
  show();
  timer = setInterval(tick, 1000);
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', show);
  app.on('before-quit', () => {
    quitting = true;
    clearInterval(timer);
    store?.close();
    store = undefined;
  });
  app
    .whenReady()
    .then(start)
    .catch((err) => {
      console.error(err);
      app.exit(1);
    });
}
