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
  notify(store.tick(idle, false));
  send();
}
const actions = {
  start: () => {
    if (!store.session) {
      store.start();
    }
  },
  end: () => {
    store.end();
  },
  setup: (v) => store.saveSetup(v),
  checkIn: (v) => store.checkIn(v),
  resolve: (v) => {
    store.resolve(v.id, v.outcome);
  },
  addProfile: (v) => store.addProfile(v),
  profile: (v) => store.chooseProfile(v),
  sensorOff: () => {
  },
  recalibrate: (v) => {
  },
  lost: () => {
    store.freshAt = null;
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
  ipcMain.handle('desk:sample', (e, value) => {
    if (!isHome(e.senderFrame.url) || !store.session || value?.session !== store.session.id || store.idle) return;
    store.freshAt = Date.now();
    if (value.cue) notify(store.prompt('drift', value.metrics.view === 'front' ? 'shoulders' : 'chin'));
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
