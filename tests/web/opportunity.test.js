import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeMakerOpportunities } from '../../app/js/analysis/opportunity.js';

test('opportunity model keeps verified professional and unknown samples out of personal evidence', () => {
  const data = {
    games: [
      { id: 1, is_taptap_made: true, tags: ['休闲'], score: 8, vendor_scale: 'solo', vendor_verification: 'verified' },
      { id: 2, is_taptap_made: true, tags: ['休闲'], score: 10, vendor_scale: 'professional', vendor_verification: 'verified' },
      { id: 3, is_taptap_made: true, tags: ['模拟'], score: 7, vendor_scale: 'small_team', vendor_verification: 'verified' },
      { id: 4, is_taptap_made: true, tags: ['射击'], score: 9, vendor_scale: 'major', vendor_verification: 'verified' },
      { id: 5, is_taptap_made: true, tags: ['文字'], score: 9, vendor_scale: 'unverified', vendor_verification: 'unverified' },
      { id: 6, is_taptap_made: false, tags: ['休闲'], score: 10, vendor_scale: 'major', vendor_verification: 'verified' },
    ],
    metrics: [
      { game_id: 1, heat_per_day_lifetime: 100, growth_per_hour_24h: 10 },
      { game_id: 2, heat_per_day_lifetime: 100_000, growth_per_hour_24h: 10_000 },
      { game_id: 3, heat_per_day_lifetime: 200, growth_per_hour_24h: 20 },
      { game_id: 4, heat_per_day_lifetime: 50_000, growth_per_hour_24h: 5_000 },
      { game_id: 5, heat_per_day_lifetime: 300, growth_per_hour_24h: 30 },
      { game_id: 6, heat_per_day_lifetime: 1_000_000, growth_per_hour_24h: 100_000 },
    ],
  };
  const result = analyzeMakerOpportunities(data, 'solo-validate');
  const casual = result.find(track => track.id === 'casual');
  const shooter = result.find(track => track.id === 'shooter');
  const narrative = result.find(track => track.id === 'narrative');

  assert.equal(result.reduce((sum, track) => sum + track.count, 0), 5);
  assert.equal(casual.personalEvidenceCount, 1);
  assert.equal(casual.referenceCount, 1);
  assert.equal(casual.unknownCount, 0);
  assert.equal(shooter.referenceCount, 1);
  assert.equal(shooter.personalEvidenceCount, 0);
  assert.equal(shooter.personalScore, 35);
  assert.equal(shooter.personalScoreBasis, 'profile_only');
  assert.equal(narrative.unknownCount, 1);
  assert.equal(narrative.personalEvidenceCount, 0);
  assert.equal(narrative.personalScore, 90);
  assert.equal(narrative.personalScoreBasis, 'profile_only');
  assert.equal(typeof casual.personalScore, 'number');
  assert.match(casual.marketConfidence.label, /样本/);
  assert.equal(casual.decisionConfidence.sampleSize, 1);

  const changedProfessionalReference = structuredClone(data);
  changedProfessionalReference.games.find(game => game.id === 2).score = 1;
  Object.assign(changedProfessionalReference.metrics.find(metric => metric.game_id === 2), {
    heat_per_day_lifetime: 1,
    growth_per_hour_24h: -1_000,
  });
  const changedCasual = analyzeMakerOpportunities(changedProfessionalReference, 'solo-validate').find(track => track.id === 'casual');
  assert.equal(changedCasual.personalScore, casual.personalScore);

  const changedUnknown = structuredClone(data);
  changedUnknown.games.find(game => game.id === 5).score = 1;
  Object.assign(changedUnknown.metrics.find(metric => metric.game_id === 5), {
    heat_per_day_lifetime: 1_000_000,
    growth_per_hour_24h: 100_000,
  });
  const changedNarrative = analyzeMakerOpportunities(changedUnknown, 'solo-validate').find(track => track.id === 'narrative');
  assert.equal(changedNarrative.personalScore, narrative.personalScore);
});
