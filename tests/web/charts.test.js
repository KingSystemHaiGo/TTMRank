import test from 'node:test';
import assert from 'node:assert/strict';

import { buildHeatBuckets, buildScatterPoints } from '../../app/js/analysis/charts.js';

test('native heat histogram preserves every finite non-negative sample', () => {
  const buckets = buildHeatBuckets([0, 10, 20, 30, null, Number.NaN], 3);

  assert.equal(buckets.length, 3);
  assert.equal(buckets.reduce((total, bucket) => total + bucket.count, 0), 4);
  assert.equal(buckets.at(-1).count, 2);
});

test('native scatter model filters invalid points and maps valid games into the viewport', () => {
  const points = buildScatterPoints([
    { id: 1, title: 'A', score: 8, heat: 100 },
    { id: 2, title: 'B', score: null, heat: 200 },
    { id: 3, title: 'C', score: 9, heat: 0 },
    { id: 4, title: 'D', score: 11, heat: 300 },
  ], { width: 640, height: 300, padding: 36 });

  assert.deepEqual(points.map(point => point.game.id), [1]);
  assert.ok(points[0].x >= 36 && points[0].x <= 604);
  assert.ok(points[0].y >= 36 && points[0].y <= 264);
});
