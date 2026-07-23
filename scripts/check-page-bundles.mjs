import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const bundles = [
  'app/js/dist/analysis-app.js',
  'app/js/dist/home-app.js',
  'app/js/dist/changes-app.js',
  'app/js/dist/universe-app.js',
  'app/js/dist/rankings-app.js',
];

for (const file of bundles) {
  const generated = await readFile(file);
  let committed;
  try {
    committed = execFileSync('git', ['show', `HEAD:${file}`], { encoding: 'buffer' });
  } catch {
    throw new Error(`${file} is not committed; run npm run build:apps and add every page bundle`);
  }
  if (!generated.equals(committed)) {
    throw new Error(`${file} is stale; run npm run build:apps and commit the generated bundle`);
  }
}

console.log(`verified ${bundles.length} committed page bundles`);
