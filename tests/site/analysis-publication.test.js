import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

import { buildWebAnalysis } from '../../scripts/analysis-publication.mjs';
import { buildBoards, latestReleasedGames } from '../../app/js/analysis/boards.js';
import { DEFAULT_FILTERS, applyFilters } from '../../app/js/analysis/filters.js';
import { coreMetrics } from '../../app/js/analysis/metrics.js';

const full = JSON.parse(readFileSync(new URL('../../app/data/v2/analysis-current.json', import.meta.url), 'utf8'));

function boardIds(data) {
  const filtered = applyFilters(data, DEFAULT_FILTERS);
  const metrics = coreMetrics(filtered);
  const boards = buildBoards(filtered, {
    platform: 'all',
    baselineMetrics: metrics,
    globalAppearances: data.appearances,
    eligibleIds: filtered.games.map(game => game.id),
  });
  return {
    games: filtered.games.map(game => game.id),
    metrics,
    latest: latestReleasedGames(filtered.games, filtered.observed_at).map(game => game.id),
    boards: Object.fromEntries(Object.entries(boards).map(([key, games]) => [key, games.map(game => game.id)])),
  };
}

test('web analysis removes display media without changing analysis results', () => {
  const web = buildWebAnalysis(full);
  assert.deepEqual(boardIds(web), boardIds(full));
  assert.ok(web.games.every(game => !Object.hasOwn(game, 'icon_source_url')));
  assert.ok(web.games.every(game => !Object.hasOwn(game, 'supported_platforms')));
  assert.ok(web.appearances.every(row => !Object.hasOwn(row, 'source')));
  assert.ok(web.metrics.every(metric => !Object.hasOwn(metric, 'heat_per_hour_lifetime')));

  const fullGzip = gzipSync(JSON.stringify(full)).byteLength;
  const webGzip = gzipSync(JSON.stringify(web)).byteLength;
  assert.ok(webGzip <= fullGzip * 0.75, `${webGzip} should be at most 75% of ${fullGzip}`);
});
