import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const root = new URL('../../work/site/', import.meta.url);
const pages = ['index.html', 'changes.html', 'universe.html', 'analysis.html', 'rankings.html'];

function read(relative) {
  return readFileSync(new URL(relative, root), 'utf8');
}

function bootstrap(page) {
  const html = read(page);
  const match = html.match(/<script id="ttmrank-bootstrap" type="application\/json">([\s\S]*?)<\/script>/u);
  assert.ok(match, `${page} has bootstrap data`);
  return JSON.parse(match[1]);
}

test('primary pages are single-document first renders', () => {
  for (const page of pages) {
    const html = read(page);
    assert.match(html, /data-ttmrank-critical/u);
    assert.match(html, /data-ttmrank-app/u);
    assert.doesNotMatch(html, /<link\b[^>]*rel=["']stylesheet/u);
    assert.doesNotMatch(html, /<script\b[^>]*src=["']js\//u);
    assert.equal((html.match(/<\/body>/gu) || []).length, 1, `${page} has one body terminator`);
    assert.ok(html.indexOf('data-ttmrank-critical') < html.indexOf('<body'), `${page} puts CSS before content`);
    assert.ok(html.indexOf('ttmrank-bootstrap') > html.indexOf('</main>'), `${page} streams content before data`);
    assert.ok(bootstrap(page), `${page} bootstrap parses`);
  }
});

test('page bootstraps carry exactly the data required by the first view', () => {
  const analysis = bootstrap('analysis.html');
  assert.equal(analysis.analysis_scope, 'made');
  assert.ok(analysis.analysis.games.length > 0);
  assert.ok(analysis.analysis.games.every(game => game.is_taptap_made));
  assert.ok(Array.isArray(analysis.quality.issues));

  const home = bootstrap('index.html');
  assert.equal(home.changes.schema_version, '1.0');
  assert.ok(home.manifest.changes_file);

  const universe = bootstrap('universe.html');
  assert.equal(universe.visual.schema_version, '1.0');
  assert.ok(universe.visual.games.length > 0);

  const rankings = bootstrap('rankings.html').rankings;
  assert.equal(rankings.charts.android.hot.items.length, rankings.meta.platforms.android.hot.count);
  assert.equal(rankings.charts.ios.hot.items.length, rankings.meta.platforms.ios.hot.count);
  assert.equal(rankings.charts.android.hot.items[0].rank, 1);
  assert.equal(rankings.charts.android.hot.items[1].rank, 2);
});

test('secondary data uses immutable filenames and every referenced file exists', () => {
  for (const page of ['index.html', 'analysis.html', 'universe.html']) {
    const manifest = bootstrap(page).manifest;
    for (const key of ['analysis_file', 'analysis_made_file', 'changes_file', 'visual_file']) {
      if (!manifest[key]) continue;
      assert.match(manifest[key], /\.[a-f0-9]{16}\.json$/u);
      assert.ok(existsSync(new URL(`data/v2/${manifest[key]}`, root)), manifest[key]);
    }
  }
  const rankings = bootstrap('rankings.html').rankings;
  for (const entries of Object.values(rankings.meta.platforms)) {
    for (const info of Object.values(entries)) {
      assert.match(info.file, /\.[a-f0-9]{16}\.json$/u);
      assert.ok(existsSync(new URL(`data/${info.file}`, root)), info.file);
    }
  }
});

test('page gzip budgets remain bounded', () => {
  const report = JSON.parse(read('data/build-report.json'));
  for (const [page, size] of Object.entries(report.pages)) {
    assert.ok(size.gzipBytes <= 90 * 1024, `${page}: ${size.gzipBytes} gzip bytes`);
  }
});
