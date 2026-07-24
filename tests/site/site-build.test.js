import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

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
  assert.equal(home.changes_view, 'home');
  assert.ok(home.changes.events.length <= 15);

  const changes = bootstrap('changes.html');
  assert.equal(changes.changes_view, 'preview');
  assert.ok(changes.changes.events.length <= 40);
  assert.ok(changes.manifest.changes_views.preview);

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
    for (const key of ['analysis_file', 'analysis_made_file', 'analysis_web_file', 'changes_file', 'visual_file']) {
      if (!manifest[key]) continue;
      assert.match(manifest[key], /\.[a-f0-9]{16}\.json$/u);
      assert.ok(existsSync(new URL(`data/v2/${manifest[key]}`, root)), manifest[key]);
    }
  }
  const changeViews = bootstrap('changes.html').manifest.changes_views;
  for (const info of [
    changeViews.home,
    changeViews.preview,
    ...Object.values(changeViews.slices).flatMap(scopes => Object.values(scopes)),
  ]) {
    assert.match(info.file, /\.[a-f0-9]{16}\.json$/u);
    assert.ok(existsSync(new URL(`data/v2/${info.file}`, root)), info.file);
  }
  const rankings = bootstrap('rankings.html').rankings;
  for (const entries of Object.values(rankings.meta.platforms)) {
    for (const info of Object.values(entries)) {
      assert.match(info.file, /\.[a-f0-9]{16}\.json$/u);
      assert.ok(existsSync(new URL(`data/${info.file}`, root)), info.file);
    }
  }
});

test('full-site web analysis preserves results with a materially smaller payload', () => {
  const manifest = bootstrap('analysis.html').manifest;
  assert.match(manifest.analysis_web_file, /^analysis-web\.[a-f0-9]{16}\.json$/u);
  const canonicalText = read(`data/v2/${manifest.analysis_file}`);
  const webText = read(`data/v2/${manifest.analysis_web_file}`);
  const canonical = JSON.parse(canonicalText);
  const web = JSON.parse(webText);

  assert.equal(web.schema_version, canonical.schema_version);
  assert.equal(web.observed_at, canonical.observed_at);
  assert.equal(web.games.length, canonical.games.length);
  assert.equal(web.appearances.length, canonical.appearances.length);
  assert.equal(web.metrics.length, canonical.metrics.length);
  assert.ok(web.games.every(game => !Object.hasOwn(game, 'icon_source_url')));
  assert.ok(gzipSync(webText).byteLength <= gzipSync(canonicalText).byteLength * 0.75);
  assert.equal(manifest.analysis_web_bytes, Buffer.byteLength(webText));
  assert.equal(manifest.analysis_web_gzip_bytes, gzipSync(webText).byteLength);
});

test('page gzip budgets remain bounded', () => {
  const report = JSON.parse(read('data/build-report.json'));
  for (const [page, size] of Object.entries(report.pages)) {
    assert.ok(size.gzipBytes <= 90 * 1024, `${page}: ${size.gzipBytes} gzip bytes`);
  }
});

test('a deployment-scale change archive cannot inflate first-view HTML', () => {
  const generated = 2_000_000;
  const source = JSON.parse(read('data/v2/changes-current.json'));
  source.generated_at = generated;
  source.status = 'ready';
  source.comparison_available = true;
  source.events = Array.from({ length: 5_000 }, (_, index) => ({
    id: `evt_${index}`, kind: 'rank_rise', scope: index % 3 ? 'made' : 'all',
    game_id: index + 1, game_title: `游戏${index}`, platform: 'android', chart: 'hot',
    before: 20, after: 10, observed_at: generated - (index % 10_000),
    first_observed_at: generated - (index % 10_000), last_observed_at: generated - (index % 10_000),
    occurrences: 1, importance: index % 100, rule: 'rank_threshold_11_50',
  }));
  const html = read('index.html');
  const current = bootstrap('index.html');
  const inflated = html.replace(
    JSON.stringify(current),
    JSON.stringify({ ...current, changes: source }),
  );
  assert.ok(gzipSync(inflated).byteLength > 90 * 1024, 'fixture reproduces the failed deploy');
  assert.ok(gzipSync(html).byteLength < 40 * 1024, 'bounded publication keeps the home page fast');
});
