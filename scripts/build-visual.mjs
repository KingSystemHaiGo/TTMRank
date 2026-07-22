import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';

await build({
  entryPoints: {
    'universe-three': 'web-src/universe-three.js',
    'change-map-pixi': 'web-src/change-map-pixi.js',
  },
  bundle: true,
  format: 'esm',
  minify: true,
  minifyWhitespace: true,
  lineLimit: 0,
  sourcemap: false,
  legalComments: 'none',
  target: ['es2022'],
  outdir: 'app/js/vendor',
  treeShaking: true,
});

for (const name of ['universe-three', 'change-map-pixi']) {
  const path = `app/js/vendor/${name}.js`;
  const source = await readFile(path, 'utf8');
  await writeFile(path, source.replace(/[ \t]+$/gm, '').replace(/^ +\t/gm, '\t').replace(/\n{2,}$/u, '\n'), 'utf8');
}
