import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_FILTERS, applyFilters } from '../../app/js/analysis/filters.js';
import { parseState, serializeState } from '../../app/js/core/state-url.js';

const data = {
  observed_at: 2_000_000,
  games: [
    { id: 1, title: '制造游戏', developer: '甲', is_taptap_made: true, tags: ['模拟'], released_at: 1_900_000, heat: 10000, score: 9 },
    { id: 2, title: '普通游戏', developer: '乙', is_taptap_made: false, tags: ['休闲'], released_at: 1_000_000, heat: 2000, score: 7 },
  ],
  appearances: [
    { game_id: 1, platform: 'ios', chart: 'casual', rank: 8 },
    { game_id: 2, platform: 'android', chart: 'hot', rank: 2 },
  ],
  metrics: [{ game_id: 1, heat_per_day_lifetime: 8000 }, { game_id: 2, heat_per_day_lifetime: 200 }],
};

test('scope, platform and ranking filters use appearances', () => {
  const result = applyFilters(data, { ...DEFAULT_FILTERS, scope: 'made', platform: 'ios', rankMax: 10 });
  assert.deepEqual(result.games.map(game => game.id), [1]);
});

test('URL state round-trips without losing ranges', () => {
  const state = { ...DEFAULT_FILTERS, scope: 'made', platform: 'ios', heatMin: 1000, growth24hMin: -10, growth24hMax: 500, released: '14d', tags: ['模拟', '休闲'] };
  assert.deepEqual(parseState(serializeState(state)), state);
});

test('analysis URL treats made as the canonical default while keeping all-site explicit', () => {
  const urlDefaults = { ...DEFAULT_FILTERS, scope: 'made' };
  assert.equal(serializeState({ ...DEFAULT_FILTERS, scope: 'made' }, urlDefaults), '');
  assert.equal(serializeState({ ...DEFAULT_FILTERS, scope: 'all' }, urlDefaults), '?scope=all');
});

test('recent hourly growth range excludes unavailable and out-of-range history', () => {
  const historyData = {
    observed_at: 2000,
    games: [{ id: 1 }, { id: 2 }, { id: 3 }],
    appearances: [{ game_id: 1, platform: 'android', chart: 'hot', rank: 1 }, { game_id: 2, platform: 'android', chart: 'hot', rank: 2 }, { game_id: 3, platform: 'android', chart: 'hot', rank: 3 }],
    metrics: [{ game_id: 1, growth_per_hour_24h: -20 }, { game_id: 2, growth_per_hour_24h: 30 }, { game_id: 3, growth_per_hour_24h: null }],
  };
  const result = applyFilters(historyData, { ...DEFAULT_FILTERS, growth24hMin: -10, growth24hMax: 100 });
  assert.deepEqual(result.games.map(game => game.id), [2]);
});

test('primary page styles contain no decorative radial background', () => {
  const styles = [
    readFileSync(new URL('../../app/css/analysis.css', import.meta.url), 'utf8'),
    readFileSync(new URL('../../app/css/style.css', import.meta.url), 'utf8'),
  ].join('\n');
  assert.doesNotMatch(styles, /radial-gradient|\borb\b/i);
});
