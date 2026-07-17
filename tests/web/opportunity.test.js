import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeGameSignals } from '../../app/js/analysis/opportunity.js';

test('game signal model uses only TapTap-made game performance', () => {
  const data = {
    games: [
      { id: 1, is_taptap_made: true, tags: ['休闲'], score: 8, heat: 1_000, developer: '甲' },
      { id: 2, is_taptap_made: true, tags: ['休闲'], score: 10, heat: 100_000, developer: '乙' },
      { id: 3, is_taptap_made: true, tags: ['模拟'], score: 7, heat: 2_000, developer: '丙' },
      { id: 4, is_taptap_made: true, tags: ['射击'], score: 9, heat: 50_000, developer: '丁' },
      { id: 5, is_taptap_made: true, tags: ['文字'], score: 9, heat: 3_000, developer: '戊' },
      { id: 6, is_taptap_made: false, tags: ['休闲'], score: 10, heat: 1_000_000, developer: '己' },
    ],
    metrics: [
      { game_id: 1, heat_per_day_lifetime: 100, growth_per_hour_24h: 10, chart_coverage: 1 },
      { game_id: 2, heat_per_day_lifetime: 100_000, growth_per_hour_24h: 10_000, chart_coverage: 6 },
      { game_id: 3, heat_per_day_lifetime: 200, growth_per_hour_24h: 20, chart_coverage: 2 },
      { game_id: 4, heat_per_day_lifetime: 50_000, growth_per_hour_24h: 5_000, chart_coverage: 5 },
      { game_id: 5, heat_per_day_lifetime: 300, growth_per_hour_24h: 30, chart_coverage: 2 },
      { game_id: 6, heat_per_day_lifetime: 1_000_000, growth_per_hour_24h: 100_000, chart_coverage: 20 },
    ],
  };
  const result = analyzeGameSignals(data);
  const casual = result.find(track => track.id === 'casual');
  const shooter = result.find(track => track.id === 'shooter');

  assert.equal(result.reduce((sum, track) => sum + track.count, 0), 5);
  assert.equal(casual.count, 2);
  assert.equal(casual.dailyMedian, 50_050);
  assert.equal(casual.heatMedian, 50_500);
  assert.equal(shooter.count, 1);
  assert.equal(typeof shooter.signalScore, 'number');
  assert.match(shooter.confidence.label, /N=1/);
  assert.equal('personalScore' in casual, false);
  assert.equal('referenceCount' in casual, false);

  const changedIdentity = structuredClone(data);
  changedIdentity.games.forEach(game => {
    game.developer = '完全不同的名称';
    game.vendor_scale = 'major';
    game.vendor_verification = 'verified';
  });
  assert.deepEqual(analyzeGameSignals(changedIdentity), result);
});
