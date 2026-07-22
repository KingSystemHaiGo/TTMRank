import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CHANGE_FILTERS,
  describeEvent,
  filterEvents,
  topEvents,
} from '../../app/js/changes/model.js';
import { loadChanges, validateChangeFeed } from '../../app/js/changes/data-client.js';
import { parseChangeState, serializeChangeState } from '../../app/js/changes/state.js';

const GENERATED_AT = 2_000_000;

function event(overrides = {}) {
  return {
    id: 'evt_default',
    kind: 'rank_rise',
    scope: 'made',
    game_id: 1,
    game_title: '制造游戏',
    game_icon: '',
    game_url: 'https://www.taptap.cn/app/1',
    platform: 'android',
    chart: 'hot',
    before: 18,
    after: 9,
    observed_at: GENERATED_AT - 120,
    first_observed_at: GENERATED_AT - 120,
    last_observed_at: GENERATED_AT - 120,
    occurrences: 1,
    importance: 80,
    rule: 'rank_threshold_11_50',
    ...overrides,
  };
}

test('describes direct rank and score changes', () => {
  assert.equal(describeEvent({ kind: 'rank_rise', before: 18, after: 9 }), '从第18名升至第9名');
  assert.equal(describeEvent({ kind: 'rank_fall', before: 9, after: 18 }), '从第9名降至第18名');
  assert.equal(describeEvent({ kind: 'score_rise', before: 8.0, after: 8.2 }), '评分从8.0升至8.2');
  assert.equal(describeEvent({ kind: 'score_fall', before: 8.2, after: 8.0 }), '评分从8.2降至8.0');
});

test('describes entry, exit, and coverage changes without vague interpretation', () => {
  assert.equal(describeEvent({ kind: 'entered', after: 12 }), '首次进入榜单，位列第12名');
  assert.equal(describeEvent({ kind: 'reentered', after: 8 }), '重新进入榜单，位列第8名');
  assert.equal(describeEvent({ kind: 'exited', before: 6 }), '跌出榜单，此前位列第6名');
  assert.equal(describeEvent({ kind: 'coverage_increase', before: 1, after: 3 }), '榜单覆盖从1个增至3个');
  assert.equal(describeEvent({ kind: 'coverage_decrease', before: 3, after: 1 }), '榜单覆盖从3个减至1个');
  assert.equal(describeEvent({ kind: 'future_kind', before: 1, after: 2 }), '记录到一项变化');
});

test('filters by range, scope, type, platform, and game query using epoch seconds', () => {
  const events = [
    event(),
    event({
      id: 'evt_score',
      kind: 'score_fall',
      scope: 'all',
      game_id: 2,
      game_title: '普通游戏',
      platform: 'ios',
      chart: null,
      before: 8.2,
      after: 8.0,
      observed_at: GENERATED_AT - 4_000,
      first_observed_at: GENERATED_AT - 4_000,
      last_observed_at: GENERATED_AT - 4_000,
    }),
    event({
      id: 'evt_exit',
      kind: 'exited',
      game_title: '制造旧作',
      platform: 'ios',
      before: 5,
      after: null,
      observed_at: GENERATED_AT - 2 * 86_400,
      first_observed_at: GENERATED_AT - 2 * 86_400,
      last_observed_at: GENERATED_AT - 2 * 86_400,
    }),
  ];

  assert.deepEqual(
    filterEvents(events, DEFAULT_CHANGE_FILTERS, GENERATED_AT).map(row => row.id),
    ['evt_default'],
  );
  assert.deepEqual(
    filterEvents(events, {
      ...DEFAULT_CHANGE_FILTERS,
      range: '24h',
      scope: 'all',
      type: 'score',
      platform: 'ios',
      query: '普通',
    }, GENERATED_AT).map(row => row.id),
    ['evt_score'],
  );
  assert.deepEqual(
    filterEvents(events, { ...DEFAULT_CHANGE_FILTERS, range: '7d', platform: 'ios' }, GENERATED_AT)
      .map(row => row.id),
    ['evt_exit'],
  );
});

test('top events use deterministic importance, recency, and id ordering', () => {
  const events = [
    event({ id: 'evt_z', importance: 90, last_observed_at: 100 }),
    event({ id: 'evt_b', importance: 90, last_observed_at: 200 }),
    event({ id: 'evt_a', importance: 90, last_observed_at: 200 }),
    event({ id: 'evt_4', importance: 80, last_observed_at: 500 }),
    event({ id: 'evt_5', importance: 70, last_observed_at: 500 }),
    event({ id: 'evt_6', importance: 60, last_observed_at: 500 }),
  ];

  assert.deepEqual(topEvents(events).map(row => row.id), ['evt_a', 'evt_b', 'evt_z', 'evt_4', 'evt_5']);
  assert.equal(events[0].id, 'evt_z');
});

test('change URL state defaults to 24 hours and made scope and round-trips known keys', () => {
  assert.deepEqual(parseChangeState('?unknown=ignored'), DEFAULT_CHANGE_FILTERS);
  const state = {
    ...DEFAULT_CHANGE_FILTERS,
    range: '7d',
    scope: 'all',
    type: 'score',
    platform: 'ios',
    query: '星火',
    event: 'evt_detail',
  };
  const search = serializeChangeState(state);
  assert.equal(search, '?range=7d&scope=all&type=score&platform=ios&query=%E6%98%9F%E7%81%AB&event=evt_detail');
  assert.deepEqual(parseChangeState(search), state);
  assert.equal(serializeChangeState(DEFAULT_CHANGE_FILTERS), '');
});

test('change URL state rejects unsupported enum values', () => {
  assert.deepEqual(
    parseChangeState('?range=forever&scope=vendor&type=opinion&platform=windows'),
    DEFAULT_CHANGE_FILTERS,
  );
});

test('validates and loads the static change feed through the manifest', async () => {
  const feed = {
    schema_version: '1.0',
    generated_at: GENERATED_AT,
    updated_at: '2026-07-22 12:00:00',
    status: 'ready',
    comparison_available: true,
    partial: false,
    suppressed_negative_event_count: 0,
    events: [event()],
  };
  assert.equal(validateChangeFeed(feed), feed);

  const requests = [];
  const fetcher = async url => {
    requests.push(url);
    if (url === 'data/v2/manifest.json') {
      return { ok: true, json: async () => ({ schema_version: '2.0', changes_file: 'changes-current.json' }) };
    }
    return { ok: true, json: async () => feed };
  };
  const result = await loadChanges(fetcher);
  assert.deepEqual(requests, ['data/v2/manifest.json', 'data/v2/changes-current.json']);
  assert.equal(result.feed, feed);
});

test('rejects malformed change feed contracts', () => {
  assert.throws(() => validateChangeFeed({ schema_version: '2.0', events: [] }), /不支持的变化数据版本/);
  assert.throws(() => validateChangeFeed({
    schema_version: '1.0',
    generated_at: GENERATED_AT,
    updated_at: '',
    status: 'ready',
    comparison_available: true,
    partial: false,
    suppressed_negative_event_count: 0,
    events: [{ kind: 'rank_rise' }],
  }), /变化事件格式无效/);
});
