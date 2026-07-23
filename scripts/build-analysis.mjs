import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

const outfile = 'app/js/dist/analysis-app.js';

await build({
  entryPoints: ['app/js/analysis/app.js'],
  bundle: true,
  format: 'esm',
  minify: true,
  minifyWhitespace: true,
  lineLimit: 0,
  sourcemap: false,
  legalComments: 'none',
  target: ['es2022'],
  outfile,
  treeShaking: true,
});

const source = (await readFile(outfile, 'utf8'))
  .replace(/[ \t]+$/gm, '')
  .replace(/\n{2,}$/u, '\n');
await writeFile(outfile, source, 'utf8');

const rawBytes = Buffer.byteLength(source);
const gzipBytes = gzipSync(source).byteLength;
if (rawBytes > 64 * 1024 || gzipBytes > 20 * 1024) {
  throw new Error(`analysis bundle exceeds budget: ${rawBytes} bytes raw / ${gzipBytes} bytes gzip`);
}
console.log(`analysis bundle: ${rawBytes} bytes raw / ${gzipBytes} bytes gzip`);
