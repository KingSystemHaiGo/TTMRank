import { gzipSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';

const budgets = new Map([
  ['app/js/vendor/universe-three.js', 200 * 1024],
  ['app/js/vendor/change-map-pixi.js', 160 * 1024],
]);

for (const [path, maximum] of budgets) {
  const source = await readFile(path);
  const gzipBytes = gzipSync(source, { level: 9 }).byteLength;
  if (gzipBytes > maximum) {
    throw new Error(`${path} is ${gzipBytes} gzip bytes; budget is ${maximum}`);
  }
  process.stdout.write(`${path}: ${source.byteLength} bytes, ${gzipBytes} gzip bytes\n`);
}

const manifest = JSON.parse(await readFile('app/data/v2/manifest.json', 'utf8'));
if (manifest.visual_bytes !== undefined && Number(manifest.visual_bytes) >= 96 * 1024) {
  throw new Error(`visual-current.json is ${manifest.visual_bytes} bytes; budget is ${96 * 1024}`);
}
if (manifest.visual_gzip_bytes !== undefined && Number(manifest.visual_gzip_bytes) >= 32 * 1024) {
  throw new Error(`visual-current.json is ${manifest.visual_gzip_bytes} gzip bytes; budget is ${32 * 1024}`);
}
