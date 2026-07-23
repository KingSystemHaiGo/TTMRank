import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

const entries = [
  ['analysis', 'app/js/analysis/app.js', 'app/js/dist/analysis-app.js', 20 * 1024],
  ['home', 'app/js/home.js', 'app/js/dist/home-app.js', 12 * 1024],
  ['changes', 'app/js/changes/app.js', 'app/js/dist/changes-app.js', 16 * 1024],
  ['universe', 'app/js/universe/app.js', 'app/js/dist/universe-app.js', 18 * 1024],
  ['rankings', 'app/js/app.js', 'app/js/dist/rankings-app.js', 12 * 1024],
];

const externalVisualRuntime = {
  name: 'external-visual-runtime',
  setup(context) {
    context.onResolve({ filter: /^\.\.\/vendor\// }, args => ({ path: args.path, external: true }));
  },
};

for (const [name, entryPoint, outfile, gzipBudget] of entries) {
  await build({
    entryPoints: [entryPoint],
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
    plugins: [externalVisualRuntime],
  });
  const source = (await readFile(outfile, 'utf8'))
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{2,}$/u, '\n');
  await writeFile(outfile, source, 'utf8');
  const rawBytes = Buffer.byteLength(source);
  const gzipBytes = gzipSync(source).byteLength;
  if (gzipBytes > gzipBudget) {
    throw new Error(`${name} bundle exceeds budget: ${rawBytes} bytes raw / ${gzipBytes} bytes gzip`);
  }
  console.log(`${name} bundle: ${rawBytes} bytes raw / ${gzipBytes} bytes gzip`);
}
