const cachePrefix = 'formline-';
const cacheName = cachePrefix + '__BUILD_VERSION__';
const here = new URL(self.registration.scope);
const index = new URL('index.html', here).href;
const shell = [
  'index.html', 'styles.css', 'main.mjs', 'pose.mjs', 'camera.mjs', 'breaks.mjs',
  'graphics.mjs', 'storage.mjs', 'manifest.webmanifest', 'assets/manrope.woff2',
  'assets/side-view.webp', 'assets/icon-180.png', 'assets/icon-192.png', 'assets/icon-512.png',
].map((path) => new URL(path, here).href);

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(cacheName).then((cache) => cache.addAll(shell)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith(cachePrefix) && name !== cacheName)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || request.headers.has('range')
    || url.origin !== here.origin || !url.pathname.startsWith(here.pathname)) return;

  const relative = url.pathname.slice(here.pathname.length);
  const isHome = request.mode === 'navigate' && (relative === '' || relative === 'index.html');
  const key = isHome ? index : request;
  const isModelAsset = relative.startsWith('vendor/') || relative === 'assets/pose_landmarker_lite.task';
  if (!isHome && !isModelAsset && !shell.includes(url.href)) return;

  event.respondWith((async () => {
    try {
      const cache = await caches.open(cacheName);
      const cached = await cache.match(key);
      if (cached) return cached;
      const response = await fetch(request);
      if (isModelAsset && response.ok && response.status === 200
        && !response.headers.get('content-type')?.includes('text/html')) {
        await cache.put(key, response.clone()).catch(() => {});
      }
      return response;
    } catch {
      return fetch(request);
    }
  })());
});
