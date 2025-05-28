import { cp, mkdir, readFile, realpath, rm, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = await realpath(fileURLToPath(new URL('..', import.meta.url)));
const out = join(root, 'dist');
const previous = await lstat(out).catch((e) => {
  if (e.code !== 'ENOENT') throw e;
});
if (previous) {
  if (previous.isSymbolicLink() || relative(root, await realpath(out)) !== 'dist')
    throw new Error('Unexpected build directory.');
  await rm(out, { recursive: true });
}
await cp(join(root, 'ui'), out, { recursive: true });
await cp(join(root, 'shared'), join(out, 'shared'), { recursive: true });
await cp(join(root, 'desktop', 'companion.mjs'), join(out, 'companion.mjs'));
const assets = join(out, 'assets');
await mkdir(assets, { recursive: true });
await cp(join(root, 'assets/icon.png'), join(assets, 'icon.png'));
const sensor = join(root, 'assets/pose_landmarker_lite.task');
if (
  createHash('sha256')
    .update(await readFile(sensor))
    .digest('hex') !== '59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a'
) {
  throw new Error('The pose sensor failed its integrity check.');
}
await cp(sensor, join(assets, 'pose.task'));
const vision = join(root, 'node_modules/@mediapipe/tasks-vision');
await cp(join(vision, 'vision_bundle.mjs'), join(out, 'vendor/vision.mjs'));
await cp(join(vision, 'wasm'), join(out, 'vendor/vision'), { recursive: true });
await cp(join(root, 'assets/mediapipe-license.txt'), join(assets, 'mediapipe-license.txt'));
console.log('Built the offline Deskframe desktop interface.');
