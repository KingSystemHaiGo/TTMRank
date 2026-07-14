import test from 'node:test';
import assert from 'node:assert/strict';
import { mean, median, percentileRank, quantile, summarize } from '../../app/js/core/statistics.js';

test('statistics match the Python interpolation contract', () => {
  assert.equal(mean([1, null, 3]), 2);
  assert.equal(median([1, 3, 5, 7]), 4);
  assert.equal(quantile([0, 10, 20, 30, 40], 0.25), 10);
  assert.equal(percentileRank([1, 2, 2, 4], 2), 0.5);
});

test('summary reports samples and distribution', () => {
  const result = summarize([10, 20, null, 30]);
  assert.deepEqual(result, { samples: 3, mean: 20, median: 20, p25: 15, p75: 25, p90: 28 });
});
