import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChangePublication } from '../../scripts/change-publication.mjs';

const GENERATED_AT = 2_000_000;

function event(index) {
  return {
    id: `evt_${index}`,
    kind: 'rank_rise',
    scope: index % 3 ? 'made' : 'all',
    game_id: index + 1,
    game_title: `游戏${index}`,
    platform: 'android',
    chart: 'hot',
    before: 20,
    after: 10,
    observed_at: GENERATED_AT - (index % 10_000),
    first_observed_at: GENERATED_AT - (index % 10_000),
    last_observed_at: GENERATED_AT - (index % 10_000),
    occurrences: 1,
    importance: index % 100,
    rule: 'rank_threshold_11_50',
  };
}

test('large change archives produce bounded first-view publications and complete slices', () => {
  const feed = { generated_at: GENERATED_AT, events: Array.from({ length: 5_000 }, (_, index) => event(index)) };
  const publication = buildChangePublication(feed);

  assert.ok(publication.home.events.length <= 15);
  assert.equal(publication.preview.events.length, 40);
  assert.equal(publication.previewComplete, false);
  assert.equal(publication.previewTotal, publication.slices['24h'].made.events.length);
  assert.equal(publication.slices['7d'].all.events.length, 5_000);
  assert.ok(publication.slices['1h'].made.events.every(row => row.scope === 'made'));
  assert.ok(Buffer.byteLength(JSON.stringify(publication.home)) < 12_000);
  assert.ok(Buffer.byteLength(JSON.stringify(publication.preview)) < 32_000);
});
