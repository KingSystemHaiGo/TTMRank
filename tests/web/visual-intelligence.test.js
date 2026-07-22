import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildUniverseLayout,
  renderMode,
  validateVisualArtifact,
} from '../../app/js/universe/model.js';
import { buildChangeMap } from '../../app/js/changes/map-model.js';

const VISUAL = {
  schema_version: '1.0',
  updated_at: '2026-07-22 18:00:00',
  observed_at: 2_000_000,
  clusters: ['模拟', '休闲'],
  games: [
    { id: 1, title: '高热模拟', icon: '', url: '', cluster: '模拟', tags: ['模拟'], heat: 1_000_000, score: 9, daily_heat: 10_000, growth_24h: 100, chart_coverage: 4, platform_coverage: 2 },
    { id: 2, title: '低热休闲', icon: '', url: '', cluster: '休闲', tags: ['休闲'], heat: 1_000, score: 7, daily_heat: 50, growth_24h: -20, chart_coverage: 1, platform_coverage: 1 },
  ],
};

test('universe artifact validation and layout are deterministic and data-bearing', () => {
  assert.equal(validateVisualArtifact(VISUAL), VISUAL);
  const first = buildUniverseLayout(VISUAL);
  const second = buildUniverseLayout(VISUAL);
  assert.deepEqual(first, second);
  assert.equal(first.nodes.length, 2);
  assert.ok(first.nodes[0].size > first.nodes[1].size, 'heat controls node size');
  assert.ok(first.nodes[0].y > first.nodes[1].y, 'score controls node height');
  assert.notEqual(first.nodes[0].angle, first.nodes[1].angle, 'clusters occupy distinct sectors');
  assert.throws(() => validateVisualArtifact({ ...VISUAL, games: [{ id: 1 }] }), /视觉数据格式无效/);
});
test('static mode wins before engine download for constrained devices', () => {
  assert.equal(renderMode({ requested: 'auto', webgl: true, saveData: false, hardwareConcurrency: 8 }), 'webgl');
  assert.equal(renderMode({ requested: 'static', webgl: true, saveData: false, hardwareConcurrency: 8 }), 'static');
  assert.equal(renderMode({ requested: 'auto', webgl: false, saveData: false, hardwareConcurrency: 8 }), 'static');
  assert.equal(renderMode({ requested: 'auto', webgl: true, saveData: true, hardwareConcurrency: 8 }), 'static');
  assert.equal(renderMode({ requested: 'auto', webgl: true, saveData: false, hardwareConcurrency: 2 }), 'static');
});

test('change map encodes time, lane and importance with a bounded deterministic model', () => {
  const events = [
    { id: 'rise', kind: 'rank_rise', last_observed_at: 1_990_000, importance: 90, game_title: '上升' },
    { id: 'score', kind: 'score_fall', last_observed_at: 1_950_000, importance: 50, game_title: '下降' },
    { id: 'old', kind: 'entered', last_observed_at: 1_000_000, importance: 100, game_title: '过旧' },
  ];
  const model = buildChangeMap(events, { generatedAt: 2_000_000, range: '24h', width: 1000, height: 420 });
  assert.deepEqual(model, buildChangeMap(events, { generatedAt: 2_000_000, range: '24h', width: 1000, height: 420 }));
  assert.equal(model.nodes.length, 2);
  assert.ok(model.nodes[0].x > model.nodes[1].x, 'newer events render farther right');
  assert.ok(model.nodes[0].radius > model.nodes[1].radius, 'importance controls radius');
  assert.notEqual(model.nodes[0].lane, model.nodes[1].lane);
});
