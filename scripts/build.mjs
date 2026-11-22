import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspace = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const source = join(workspace, 'app');
const dist = join(workspace, 'dist');
const mediaPipe = join(workspace, 'node_modules', '@mediapipe', 'tasks-vision');
const fontSource = join(workspace, 'node_modules', '@fontsource-variable', 'manrope');
const model = await readFile(join(source, 'assets', 'pose_landmarker_lite.task'));
const hash = (data) => createHash('sha256').update(data).digest('hex');

if (hash(model) !== '59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a') {
  throw new Error('The MediaPipe Lite model does not match the expected SHA-256.');
}
await lstat(join(mediaPipe, 'vision_bundle.mjs'));
const font = join(fontSource, 'files', 'manrope-latin-wght-normal.woff2');
await lstat(font);

const existing = await lstat(dist).catch((error) => {
  if (error.code !== 'ENOENT') throw error;
});
if (existing) {
  // Only clean the generated directory immediately inside this workspace.
  if (!existing.isDirectory() || existing.isSymbolicLink() || relative(workspace, await realpath(dist)) !== 'dist') {
    throw new Error('Refusing to replace dist because it is not the project build directory.');
  }
  await rm(dist, { recursive: true });
}
await cp(source, dist, { recursive: true });

const vendor = join(dist, 'vendor');
await mkdir(vendor, { recursive: true });
await cp(join(mediaPipe, 'vision_bundle.mjs'), join(vendor, 'vision_bundle.mjs'));
await cp(join(mediaPipe, 'wasm'), join(vendor, 'wasm'), { recursive: true });
await cp(font, join(dist, 'assets', 'manrope.woff2'));
await cp(join(fontSource, 'LICENSE'), join(dist, 'assets', 'manrope-license.txt'));

const version = createHash('sha256');
for (const path of (await readdir(dist, { recursive: true })).sort()) {
  const target = join(dist, path);
  if ((await lstat(target)).isFile()) {
    version.update(path);
    version.update(await readFile(target));
  }
}
const worker = join(dist, 'sw.js');
await writeFile(worker, (await readFile(worker, 'utf8')).replace('__BUILD_VERSION__', version.digest('hex').slice(0, 14)));
console.log(`Built Formline at ${dist}`);
