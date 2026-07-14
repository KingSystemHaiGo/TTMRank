import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBoards, nonHotNewIds } from '../../app/js/analysis/boards.js';

test('non-hot-new evaluates platforms independently', () => {
  const rows = [
    { game_id: 1, platform: 'android', chart: 'hot', rank: 1 },
    { game_id: 1, platform: 'ios', chart: 'casual', rank: 8 },
    { game_id: 2, platform: 'android', chart: 'strategy', rank: 4 },
  ];
  assert.deepEqual([...nonHotNewIds(rows, 'android')], [2]);
  assert.deepEqual([...nonHotNewIds(rows, 'ios')], [1]);
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
