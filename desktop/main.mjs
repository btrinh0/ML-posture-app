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
const actions = {
  setup: (v) => store.saveSetup(v),
  addProfile: (v) => store.addProfile(v),
  profile: (v) => store.chooseProfile(v),
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
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, cb) => cb(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
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
  ipcMain.handle('desk:state', (e) => {
    if (isHome(e.senderFrame.url)) return state();
  });
  ipcMain.handle('desk:action', async (e, name, value) => {
    if (!isHome(e.senderFrame.url) || !Object.hasOwn(actions, name)) throw new Error('Unknown action.');
    await actions[name](value);
    send();
    return state();
  });
  await win.loadURL(home);
  show();
}
{
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
