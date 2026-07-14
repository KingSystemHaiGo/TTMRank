import test from 'node:test';
import assert from 'node:assert/strict';
import { describeReport } from '../../app/js/analysis/report.js';

test('report description records scope, filters, baseline, sample and generation time', () => {
  const text = describeReport({ scope: 'made', platform: 'ios', released: '14d', growth24hMin: 10, baseline: 'fixed' }, 23, '2026-07-14 18:00');
  assert.match(text, /TapTap制造/);
  assert.match(text, /iOS/);
  assert.match(text, /近14天/);
  assert.match(text, /近24小时每小时增长 ≥ 10/);
  assert.match(text, /固定基准/);
  assert.match(text, /23/);
  assert.match(text, /2026-07-14 18:00/);
});
