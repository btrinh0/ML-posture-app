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
await cp(join(root, 'desktop', 'companion.mjs'), join(out, 'companion.mjs'));
const assets = join(out, 'assets');
await mkdir(assets, { recursive: true });
await cp(join(root, 'assets/icon.png'), join(assets, 'icon.png'));
console.log('Built the offline Deskframe desktop interface.');
