import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBoards, nonHotNewIds } from '../../app/js/analysis/boards.js';

test('non-hot-new excludes games found in hot or new on either platform', () => {
  const rows = [
    { game_id: 1, platform: 'android', chart: 'hot', rank: 1 },
    { game_id: 1, platform: 'ios', chart: 'casual', rank: 8 },
    { game_id: 2, platform: 'android', chart: 'strategy', rank: 4 },
    { game_id: 3, platform: 'ios', chart: 'new', rank: 3 },
    { game_id: 3, platform: 'android', chart: 'strategy', rank: 5 },
  ];
  assert.deepEqual([...nonHotNewIds(rows, 'android')], [2]);
  assert.deepEqual([...nonHotNewIds(rows, 'ios')], []);
  assert.deepEqual([...nonHotNewIds(rows, 'all')], [2]);
});

test('platform-filtered board still uses the full cross-platform exclusion set', () => {
  const games = [{ id: 1, heat: 100, score: 9, released_at: 1 }, { id: 2, heat: 20, score: 7, released_at: 1 }];
  const metrics = [{ game_id: 1, heat_per_day_lifetime: 80, age_hours: 20 }, { game_id: 2, heat_per_day_lifetime: 10, age_hours: 100 }];
  const globalAppearances = [
    { game_id: 1, platform: 'android', chart: 'hot', rank: 1 },
    { game_id: 1, platform: 'ios', chart: 'casual', rank: 2 },
    { game_id: 2, platform: 'ios', chart: 'strategy', rank: 3 },
  ];
  const filteredAppearances = globalAppearances.filter(row => row.platform === 'ios');
  const boards = buildBoards(
    { games, metrics, appearances: filteredAppearances },
    { platform: 'ios', globalAppearances, eligibleIds: games.map(game => game.id) },
  );
  assert.deepEqual(boards.nonHotNew.map(game => game.id), [2]);
});

test('buildBoards returns transparent analysis sections', () => {
  const games = [{ id: 1, heat: 100, score: 9, released_at: 1 }, { id: 2, heat: 20, score: 7, released_at: 1 }];
  const metrics = [{ game_id: 1, heat_per_day_lifetime: 80, age_hours: 20 }, { game_id: 2, heat_per_day_lifetime: 10, age_hours: 100 }];
  const appearances = [{ game_id: 1, platform: 'ios', chart: 'casual', rank: 2 }, { game_id: 2, platform: 'android', chart: 'new', rank: 3 }];
  const boards = buildBoards({ games, metrics, appearances });
  assert.equal(boards.dailyHeat[0].id, 1);
  assert.equal(boards.nonHotNew[0].id, 1);
  assert.equal(boards.iosExclusive[0].id, 1);
});

test('potential board sorts by transparent percentile score with and without history', () => {
  const games = [
    { id: 1, heat: 20, score: 9.5, released_at: 1 },
    { id: 2, heat: 30, score: 9, released_at: 1 },
    { id: 3, heat: 1000, score: 5, released_at: 1 },
  ];
  const appearances = games.map((game, index) => ({ game_id: game.id, platform: 'ios', chart: 'casual', rank: index + 1 }));
  const noHistory = [{ game_id: 1, heat_per_day_lifetime: 80, age_hours: 20 }, { game_id: 2, heat_per_day_lifetime: 100, age_hours: 20 }, { game_id: 3, heat_per_day_lifetime: 1, age_hours: 1000 }];
  const baselineMetrics = { scoreMedian: 8, heatMedian: 500, dailyMedian: 50 };
  const fallback = buildBoards({ games, metrics: noHistory, appearances }, { baselineMetrics });
  assert.equal(fallback.potential[0].id, 2);
  assert.equal(fallback.potential[0].potentialScore, 52.5);

  const history = noHistory.map(metric => ({ ...metric, history_available: true, growth_per_hour_24h: metric.game_id === 1 ? 100 : 1 }));
  const enriched = buildBoards({ games, metrics: history, appearances }, { baselineMetrics });
  assert.equal(enriched.potential[0].id, 1);
  assert.equal(enriched.potential[0].potentialScore, 55);
});
