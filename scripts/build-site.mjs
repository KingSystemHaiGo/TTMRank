import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const APP_ROOT = resolve('app');
const outputArg = process.argv.indexOf('--output');
const OUTPUT_ROOT = resolve(outputArg >= 0 ? process.argv[outputArg + 1] : 'work/site');
const JSON_KEYS = [
  ['analysis_file', 'analysis_sha256'],
  ['analysis_made_file', 'analysis_made_sha256'],
  ['quality_file', 'quality_sha256'],
  ['changes_file', 'changes_sha256'],
  ['visual_file', 'visual_sha256'],
];
const PAGES = {
  'index.html': { css: ['tokens.css', 'base.css', 'home.css'], bundle: 'home-app.js', bootstrap: 'changes' },
  'changes.html': { css: ['tokens.css', 'base.css', 'changes.css'], bundle: 'changes-app.js', bootstrap: 'changes' },
  'universe.html': { css: ['tokens.css', 'base.css', 'universe.css'], bundle: 'universe-app.js', bootstrap: 'visual' },
  'analysis.html': { css: ['tokens.css', 'base.css', 'components.css', 'analysis.css', 'print.css'], bundle: 'analysis-app.js', bootstrap: 'analysis' },
  'rankings.html': { css: ['tokens.css', 'base.css', 'style.css'], bundle: 'rankings-app.js', bootstrap: 'rankings' },
};

const json = async path => JSON.parse(await readFile(path, 'utf8'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const compact = value => Buffer.from(JSON.stringify(value), 'utf8');
const hashedName = (file, digest) => `${file.slice(0, -5)}.${digest.slice(0, 16)}.json`;
const safeJson = value => JSON.stringify(value)
  .replaceAll('&', '\\u0026')
  .replaceAll('<', '\\u003c')
  .replaceAll('>', '\\u003e')
  .replaceAll('\u2028', '\\u2028')
  .replaceAll('\u2029', '\\u2029');
const safeScript = source => source.replace(/<\/script/giu, '<\\/script');

function madeAnalysis(full) {
  const games = full.games.filter(game => game.is_taptap_made);
  const ids = new Set(games.map(game => game.id));
  return {
    schema_version: full.schema_version,
    updated_at: full.updated_at,
    observed_at: full.observed_at,
    games,
    appearances: full.appearances.filter(row => ids.has(row.game_id)),
    metrics: full.metrics.filter(row => ids.has(row.game_id)),
  };
}

function leanAnalysis(value) {
  return {
    schema_version: value.schema_version,
    updated_at: value.updated_at,
    observed_at: value.observed_at,
    games: value.games,
    appearances: value.appearances,
    metrics: value.metrics,
  };
}

async function publishImmutable(sourceRoot, outputRoot, manifest, fileKey, shaKey, fallbackPayload = null) {
  let bytes;
  const sourceFile = manifest[fileKey];
  if (sourceFile) {
    try {
      bytes = await readFile(join(sourceRoot, sourceFile));
    } catch {
      if (fallbackPayload === null) throw new Error(`missing ${sourceFile}`);
    }
  }
  if (!bytes && fallbackPayload !== null) bytes = compact(fallbackPayload);
  if (!bytes) return null;
  const digest = sha256(bytes);
  const file = hashedName(sourceFile || fileKey.replace('_file', '.json'), digest);
  await writeFile(join(outputRoot, file), bytes);
  manifest[fileKey] = file;
  manifest[shaKey] = digest;
  return { file, digest, bytes, payload: JSON.parse(bytes.toString('utf8')) };
}

function replaceStyles(html, css) {
  let inserted = false;
  const replacement = `\n  <style data-ttmrank-critical>\n${css}\n  </style>`;
  return html.replace(/\s*<link\b[^>]*\brel=["']stylesheet["'][^>]*>/giu, () => {
    if (inserted) return '';
    inserted = true;
    return replacement;
  });
}

function replaceApplication(html, bootstrap, bundle) {
  const application = `<script id="ttmrank-bootstrap" type="application/json">${safeJson(bootstrap)}</script>\n  <script type="module" data-ttmrank-app>\n${safeScript(bundle)}\n  </script>`;
  const withoutSource = html.replace(/\s*<script\b[^>]*\bsrc=["']js\/(?:dist\/)?[^"']+["'][^>]*><\/script>/iu, '');
  if (withoutSource === html) throw new Error('application script tag was not found');
  return withoutSource.replace(
    '</body>',
    () => `  ${application}\n</body>`,
  );
}

async function buildRankingsBootstrap() {
  const dataRoot = join(APP_ROOT, 'data');
  const outputData = join(OUTPUT_ROOT, 'data');
  const meta = await json(join(dataRoot, 'meta.json'));
  const charts = { android: {}, ios: {} };
  for (const [platform, entries] of Object.entries(meta.platforms || {})) {
    for (const [key, info] of Object.entries(entries || {})) {
      const sourceName = `rankings-${platform}-${key}.json`;
      const bytes = await readFile(join(dataRoot, sourceName));
      const digest = sha256(bytes);
      const file = hashedName(sourceName, digest);
      await writeFile(join(outputData, file), bytes);
      Object.assign(info, { file, sha256: digest });
      if (key === 'hot' && (platform === 'android' || platform === 'ios')) {
        charts[platform].hot = JSON.parse(bytes.toString('utf8'));
      }
    }
  }
  await writeFile(join(outputData, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  return { meta, charts };
}

await rm(OUTPUT_ROOT, { recursive: true, force: true });
await mkdir(OUTPUT_ROOT, { recursive: true });
await cp(APP_ROOT, OUTPUT_ROOT, {
  recursive: true,
  filter: source => !/(?:^|[\\/])(?:__pycache__|\.cache|\.state)(?:[\\/]|$)/u.test(source),
});

const sourceV2 = join(APP_ROOT, 'data', 'v2');
const outputV2 = join(OUTPUT_ROOT, 'data', 'v2');
const manifest = await json(join(sourceV2, 'manifest.json'));
const full = await json(join(sourceV2, manifest.analysis_file));
const madeFallback = madeAnalysis(full);
const artifacts = {};
for (const [fileKey, shaKey] of JSON_KEYS) {
  const fallback = fileKey === 'analysis_made_file' ? madeFallback : null;
  artifacts[fileKey] = await publishImmutable(sourceV2, outputV2, manifest, fileKey, shaKey, fallback);
}

if (!artifacts.analysis_made_file) {
  throw new Error('TapTap-made analysis bootstrap could not be built');
}
await writeFile(join(outputV2, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

const bootstrap = {
  analysis: {
    manifest,
    analysis_scope: 'made',
    analysis: leanAnalysis(artifacts.analysis_made_file.payload),
    quality: artifacts.quality_file?.payload || { schema_version: '2.0', issues: [] },
  },
  changes: { manifest, changes: artifacts.changes_file.payload },
  visual: { manifest, visual: artifacts.visual_file.payload },
  rankings: { rankings: await buildRankingsBootstrap() },
};

const report = { output: OUTPUT_ROOT, pages: {}, immutableData: [] };
for (const [page, config] of Object.entries(PAGES)) {
  let html = await readFile(join(APP_ROOT, page), 'utf8');
  const css = (await Promise.all(config.css.map(file => readFile(join(APP_ROOT, 'css', file), 'utf8')))).join('\n');
  let bundle = await readFile(join(APP_ROOT, 'js', 'dist', config.bundle), 'utf8');
  bundle = bundle.replaceAll('import("../vendor/', 'import("./js/vendor/');
  html = replaceStyles(html, css);
  html = replaceApplication(html, bootstrap[config.bootstrap], bundle);
  await writeFile(join(OUTPUT_ROOT, page), html, 'utf8');
  const rawBytes = Buffer.byteLength(html);
  const gzipBytes = gzipSync(html).byteLength;
  if (rawBytes > 450 * 1024 || gzipBytes > 90 * 1024) {
    throw new Error(`${page} exceeds HTML budget: ${rawBytes} raw / ${gzipBytes} gzip`);
  }
  report.pages[page] = { rawBytes, gzipBytes };
}

for (const [fileKey] of JSON_KEYS) {
  const artifact = artifacts[fileKey];
  if (artifact) report.immutableData.push({ file: artifact.file, bytes: artifact.bytes.length });
}
report.rankingsBootstrapBytes = Buffer.byteLength(safeJson(bootstrap.rankings));
await mkdir(join(OUTPUT_ROOT, 'data'), { recursive: true });
await writeFile(join(OUTPUT_ROOT, 'data', 'build-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report, null, 2));
