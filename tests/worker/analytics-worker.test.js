import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { __test } from '../../cloudflare/analytics-worker.js';
import scheduler, { dispatchRefresh } from '../../cloudflare/scheduler-worker.js';

test('Cloudflare cron dispatches the central refresh workflow once', async () => {
  const requests = [];
  const result = await dispatchRefresh({
    GITHUB_ACTIONS_TOKEN: 'token',
    GITHUB_REPOSITORY: 'KingSystemHaiGo/TTMRank',
    GITHUB_WORKFLOW: 'refresh.yml',
    GITHUB_REF: 'main',
  }, async (url, options) => {
    requests.push({ url, options });
    return new Response(null, { status: 204 });
  });

  assert.equal(result.status, 204);
  assert.equal(requests.length, 1);
  assert.equal(
    requests[0].url,
    'https://api.github.com/repos/KingSystemHaiGo/TTMRank/actions/workflows/refresh.yml/dispatches',
  );
  assert.equal(requests[0].options.method, 'POST');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer token');
  assert.deepEqual(JSON.parse(requests[0].options.body), { ref: 'main' });
});

test('Cloudflare cron rejects missing configuration and GitHub failures', async () => {
  await assert.rejects(() => dispatchRefresh({}, async () => new Response(null, { status: 204 })), /configuration/);
  await assert.rejects(() => dispatchRefresh({
    GITHUB_ACTIONS_TOKEN: 'token',
    GITHUB_REPOSITORY: 'KingSystemHaiGo/TTMRank',
    GITHUB_WORKFLOW: 'refresh.yml',
    GITHUB_REF: 'main',
  }, async () => new Response('forbidden', { status: 403 })), /GitHub dispatch failed.*403/);
  await assert.rejects(() => dispatchRefresh({
    GITHUB_ACTIONS_TOKEN: 'token',
    GITHUB_REPOSITORY: 'KingSystemHaiGo/TTMRank',
    GITHUB_WORKFLOW: 'refresh.yml',
    GITHUB_REF: 'main',
  }, async () => { throw new Error('network down'); }), /network down/);
});

test('scheduler exposes a harmless health response and delegates scheduled work', async () => {
  const response = await scheduler.fetch();
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'TTMRank scheduler is active.');
  let scheduled;
  scheduler.scheduled(null, {}, { waitUntil(promise) { scheduled = promise; } });
  assert.ok(scheduled instanceof Promise);
  await assert.rejects(scheduled);
});

test('worker integer validation and origins are strict', () => {
  assert.equal(__test.validInteger('42'),42); assert.equal(__test.validInteger('4.2'),null);
  assert.equal(__test.allowedOrigins({ALLOWED_ORIGINS:'https://a.example, https://b.example'}).has('https://b.example'),true);
});

test('snapshot rows reject malformed identifiers, hours, heat and score', () => {
  assert.deepEqual(__test.validSnapshot({ game_id: 7, captured_hour: 1_800_000_000, heat: 20, score: 8.5 }), { game_id: 7, captured_hour: 1_800_000_000, heat: 20, score: 8.5 });
  assert.equal(__test.validSnapshot({ game_id: null, captured_hour: 1_800_000_000, heat: 20 }), null);
  assert.equal(__test.validSnapshot({ game_id: 7, captured_hour: 1_800_000_001, heat: 20 }), null);
  assert.equal(__test.validSnapshot({ game_id: 7, captured_hour: 1_800_000_000, heat: -1 }), null);
  assert.equal(__test.validSnapshot({ game_id: 7, captured_hour: 1_800_000_000, heat: 20, score: 99 }), null);
});

function changeEvent(overrides = {}) {
  return {
    id: 'evt_0123456789abcdef0123456789abcdef',
    game_id: 7,
    scope: 'made',
    kind: 'rank_rise',
    platform: 'android',
    chart: 'hot',
    before: 18,
    after: 9,
    observed_at: 1_800_000_000,
    first_observed_at: 1_800_000_000,
    last_observed_at: 1_800_000_000,
    occurrences: 1,
    importance: 83,
    ...overrides,
  };
}

test('event ingest requires the configured ingest token', async () => {
  const env = { INGEST_TOKEN: 'secret', DB: { prepare() { throw new Error('must not query'); } } };
  for (const token of [null, 'wrong']) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['X-Ingest-Token'] = token;
    const response = await worker.fetch(new Request('https://example.test/v1/events', {
      method: 'POST',
      headers,
      body: JSON.stringify({ events: [changeEvent()] }),
    }), env);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: 'unauthorized' });
  }
});

test('event ingest rejects invalid kinds and oversized batches', async () => {
  const env = { INGEST_TOKEN: 'secret', DB: { prepare() { throw new Error('must not query'); } } };
  const request = events => new Request('https://example.test/v1/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Ingest-Token': 'secret' },
    body: JSON.stringify({ events }),
  });

  const invalid = await worker.fetch(request([changeEvent({ kind: 'vendor_verified' })]), env);
  assert.equal(invalid.status, 400);
  assert.deepEqual(await invalid.json(), { error: 'invalid event row' });

  const oversized = await worker.fetch(request(Array.from({ length: 501 }, (_, index) => (
    changeEvent({ id: `evt_${String(index).padStart(32, '0')}` })
  ))), env);
  assert.equal(oversized.status, 413);
  assert.deepEqual(await oversized.json(), { error: 'too many events' });
});

test('valid events are inserted idempotently in one D1 batch', async () => {
  const calls = [];
  const batches = [];
  const env = {
    INGEST_TOKEN: 'secret',
    DB: {
      prepare(sql) {
        return {
          bind(...bindings) {
            const statement = { sql, bindings };
            calls.push(statement);
            return statement;
          },
        };
      },
      async batch(statements) { batches.push(statements); return []; },
    },
  };
  const event = changeEvent();
  const response = await worker.fetch(new Request('https://example.test/v1/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Ingest-Token': 'secret' },
    body: JSON.stringify({ events: [event] }),
  }), env);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, written: 1 });
  assert.equal(batches.length, 1);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /INSERT INTO game_change_events/i);
  assert.match(calls[0].sql, /ON CONFLICT\(event_id\) DO NOTHING/i);
  assert.equal(calls[0].bindings[0], event.id);
  assert.equal(calls[0].bindings[1], event.game_id);
  assert.equal(calls[0].bindings.at(-1), JSON.stringify(event));
});

test('event archive query uses bounded parameters and CORS', async () => {
  const calls = [];
  const stored = changeEvent();
  const env = {
    ALLOWED_ORIGINS: 'https://allowed.example',
    DB: {
      prepare(sql) {
        return {
          bind(...bindings) {
            calls.push({ sql, bindings });
            return this;
          },
          async all() { return { results: [{ payload_json: JSON.stringify(stored) }] }; },
        };
      },
    },
  };
  const response = await worker.fetch(new Request(
    'https://example.test/v1/events?since=1799990000&scope=made&limit=9999',
    { headers: { Origin: 'https://allowed.example' } },
  ), env);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://allowed.example');
  assert.deepEqual(await response.json(), { events: [stored] });
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /last_observed_at\s*>=\s*\?/i);
  assert.match(calls[0].sql, /scope\s*=\s*\?/i);
  assert.match(calls[0].sql, /LIMIT\s*\?/i);
  assert.deepEqual(calls[0].bindings, [1_799_990_000, 'made', 500]);
});

test('limited body reader enforces actual bytes without trusting Content-Length', async () => {
  const response = new Response(new Uint8Array([1, 2, 3, 4]));
  assert.deepEqual([...await __test.readLimitedBytes(response, 4)], [1, 2, 3, 4]);
  await assert.rejects(() => __test.readLimitedBytes(new Response(new Uint8Array(5)), 4), /too large/);
});

test('maintenance cutoffs use UTC day boundaries and bounded retention settings', () => {
  const now = Date.UTC(2026, 6, 16, 15, 30) / 1000;
  const cutoffs = __test.maintenanceCutoffs(now, {});
  assert.equal(cutoffs.today, Date.UTC(2026, 6, 16) / 1000);
  assert.equal(cutoffs.hourly_days, 90);
  assert.equal(cutoffs.daily_days, 730);
  assert.equal(cutoffs.event_days, 180);
  assert.equal(cutoffs.today - cutoffs.hourly_cutoff, 90 * 86400);
  assert.equal(cutoffs.today - cutoffs.daily_cutoff, 730 * 86400);
  assert.equal(cutoffs.today - cutoffs.event_cutoff, 180 * 86400);

  const bounded = __test.maintenanceCutoffs(now, { HOURLY_RETENTION_DAYS: '1', DAILY_RETENTION_DAYS: '99999' });
  assert.equal(bounded.hourly_days, 90);
  assert.equal(bounded.daily_days, 730);
  assert.equal(bounded.event_days, 180);
});

test('maintenance run identifiers accept only compact audit-safe values', () => {
  const accepted = new Request('https://example.test/v1/maintenance', { headers: { 'X-Maintenance-Run': '12345-2' } });
  assert.equal(__test.maintenanceRunId(accepted), '12345-2');

  const rejected = new Request('https://example.test/v1/maintenance', { headers: { 'X-Maintenance-Run': '../unsafe value' } });
  assert.match(__test.maintenanceRunId(rejected), /^[0-9a-f-]{36}$/);
});

test('database change counts tolerate D1 and test result shapes', () => {
  assert.equal(__test.databaseChanges({ meta: { changes: 12 } }), 12);
  assert.equal(__test.databaseChanges({ changes: 4 }), 4);
  assert.equal(__test.databaseChanges(null), 0);
  assert.equal(__test.firstResultInteger({ results: [{ row_count: 19 }] }, 'row_count'), 19);
  assert.equal(__test.firstResultInteger({ results: [] }, 'row_count'), 0);
});

test('snapshot window uses the UTC hourly cutoff and permits at most one hour of forward skew', () => {
  const now = Date.UTC(2026, 6, 16, 15, 30) / 1000;
  const cutoff = __test.maintenanceCutoffs(now, {}).hourly_cutoff;

  assert.equal(__test.snapshotWindowError([{ captured_hour: cutoff }], now, {}), null);
  assert.equal(
    __test.snapshotWindowError([{ captured_hour: cutoff - 3_600 }], now, {}),
    'snapshot outside retained hourly window',
  );
  assert.equal(
    __test.snapshotWindowError([{ captured_hour: Math.floor(now / 3_600) * 3_600 + 3_600 }], now, {}),
    null,
  );
  assert.equal(
    __test.snapshotWindowError([{ captured_hour: Math.floor(now / 3_600) * 3_600 + 7_200 }], now, {}),
    'snapshot too far in the future',
  );
});

test('archived-through watermark stays authoritative when hourly retention is expanded', () => {
  const now = Date.UTC(2026, 6, 16, 15, 30) / 1000;
  const today = Math.floor(now / 86_400) * 86_400;
  const archivedThrough = today - 90 * 86_400;
  const replayedHour = archivedThrough - 10 * 86_400;

  assert.equal(
    __test.snapshotWindowError(
      [{ captured_hour: replayedHour }],
      now,
      { HOURLY_RETENTION_DAYS: '180' },
      archivedThrough,
    ),
    'snapshot already archived',
  );
});

test('ingest rejects an out-of-window batch before preparing or writing any row', async () => {
  const now = Math.floor(Date.now() / 1000);
  const tooOld = __test.maintenanceCutoffs(now, {}).hourly_cutoff - 3_600;
  let prepared = 0;
  let batches = 0;
  const env = {
    INGEST_TOKEN: 'secret',
    DB: {
      prepare() {
        prepared += 1;
        return { bind() { return this; }, async first() { return { archived_through: 0 }; } };
      },
      async batch() { batches += 1; return []; },
    },
  };
  const request = new Request('https://example.test/v1/snapshots', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Ingest-Token': 'secret' },
    body: JSON.stringify({
      snapshots: [
        { game_id: 7, captured_hour: Math.floor(now / 3_600) * 3_600, heat: 10, score: 8 },
        { game_id: 8, captured_hour: tooOld, heat: 20, score: 9 },
      ],
    }),
  });

  const response = await worker.fetch(request, env);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'snapshot outside retained hourly window' });
  assert.equal(prepared, 1);
  assert.equal(batches, 0);
});

test('ingest rejects a batch more than one hour ahead before any write', async () => {
  const now = Math.floor(Date.now() / 1000);
  const tooFarAhead = Math.floor(now / 3_600) * 3_600 + 7_200;
  let prepared = 0;
  let batches = 0;
  const env = {
    INGEST_TOKEN: 'secret',
    DB: {
      prepare() {
        prepared += 1;
        return { bind() { return this; }, async first() { return { archived_through: 0 }; } };
      },
      async batch() { batches += 1; return []; },
    },
  };
  const request = new Request('https://example.test/v1/snapshots', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Ingest-Token': 'secret' },
    body: JSON.stringify({ snapshots: [
      { game_id: 7, captured_hour: tooFarAhead, heat: 10, score: 8 },
    ] }),
  });

  const response = await worker.fetch(request, env);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'snapshot too far in the future' });
  assert.equal(prepared, 1);
  assert.equal(batches, 0);
});

test('ingest reads the durable watermark and rejects a replay after retention expansion', async () => {
  const now = Math.floor(Date.now() / 1000);
  const today = Math.floor(now / 86_400) * 86_400;
  const archivedThrough = today - 90 * 86_400;
  const replayedHour = archivedThrough - 10 * 86_400;
  const calls = [];
  let batches = 0;
  const env = {
    INGEST_TOKEN: 'secret',
    HOURLY_RETENTION_DAYS: '180',
    DB: {
      prepare(sql) {
        calls.push(sql);
        return {
          bind() { return this; },
          async first() { return { archived_through: archivedThrough }; },
        };
      },
      async batch() { batches += 1; return []; },
    },
  };
  const response = await worker.fetch(new Request('https://example.test/v1/snapshots', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Ingest-Token': 'secret' },
    body: JSON.stringify({ snapshots: [
      { game_id: 7, captured_hour: replayedHour, heat: 10, score: 8 },
    ] }),
  }), env);

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: 'snapshot already archived' });
  assert.equal(calls.length, 1);
  assert.match(calls[0], /history_retention_state/);
  assert.equal(batches, 0);
});

test('database watermark guard turns an ingest race into a friendly all-batch rejection', async () => {
  const now = Math.floor(Date.now() / 1000);
  const capturedHour = Math.floor(now / 3_600) * 3_600;
  let batchSize = 0;
  const env = {
    INGEST_TOKEN: 'secret',
    DB: {
      prepare(sql) {
        return {
          sql,
          bind() { return this; },
          async first() { return { archived_through: 0 }; },
        };
      },
      async batch(statements) {
        batchSize = statements.length;
        throw new Error('D1_ERROR: TTMRANK_ARCHIVED_HOUR');
      },
    },
  };
  const response = await worker.fetch(new Request('https://example.test/v1/snapshots', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Ingest-Token': 'secret' },
    body: JSON.stringify({ snapshots: [
      { game_id: 7, captured_hour: capturedHour, heat: 10, score: 8 },
      { game_id: 8, captured_hour: capturedHour, heat: 20, score: 9 },
    ] }),
  }), env);

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: 'snapshot already archived' });
  assert.equal(batchSize, 2);
});

test('daily series merges archived and live UTC days with live rows taking precedence', async () => {
  const prepared = [];
  const env = {
    DB: {
      prepare(sql) {
        const call = { sql, bindings: null };
        prepared.push(call);
        return {
          bind(...bindings) {
            call.bindings = bindings;
            return this;
          },
          async all() { return { results: [] }; },
        };
      },
    },
  };
  const from = Date.UTC(2026, 6, 1) / 1000;
  const to = Date.UTC(2026, 6, 16) / 1000;
  const response = await worker.fetch(new Request(
    `https://example.test/v1/series?game_id=7&grain=day&from=${from}&to=${to}`,
  ), env);

  assert.equal(response.status, 200);
  assert.equal(prepared.length, 1);
  assert.match(prepared[0].sql, /game_heat_daily/);
  assert.match(prepared[0].sql, /game_heat_hourly/);
  assert.match(prepared[0].sql, /captured_day\s*>=\s*\?\s+AND\s+captured_day\s*<\s*\?/i);
  assert.match(prepared[0].sql, /captured_hour\s*>=\s*\?\s+AND\s+captured_hour\s*<\s*\?/i);
  assert.match(prepared[0].sql, /NOT EXISTS[\s\S]+live/i);
  assert.deepEqual(prepared[0].bindings, [7, from, to, 7, from, to]);
});

test('daily series requires both range endpoints to be aligned UTC day boundaries', async () => {
  let prepared = 0;
  const env = {
    DB: {
      prepare() { prepared += 1; throw new Error('query must not be prepared'); },
    },
  };
  const day = Date.UTC(2026, 6, 1) / 1000;
  for (const [from, to] of [[day + 3_600, day + 86_400], [day, day + 90_000]]) {
    const response = await worker.fetch(new Request(
      `https://example.test/v1/series?game_id=7&grain=day&from=${from}&to=${to}`,
    ), env);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'invalid series parameters' });
  }
  assert.equal(prepared, 0);
});

test('series ranges honor the configured hourly and daily retention windows', async () => {
  const to = Date.UTC(2026, 6, 16) / 1000;
  const env = {
    HOURLY_RETENTION_DAYS: '180',
    DAILY_RETENTION_DAYS: '1000',
    DB: {
      prepare() {
        return {
          bind() { return this; },
          async all() { return { results: [] }; },
        };
      },
    },
  };

  for (const [grain, days] of [['hour', 180], ['day', 1000]]) {
    const from = to - days * 86_400;
    const response = await worker.fetch(new Request(
      `https://example.test/v1/series?game_id=7&grain=${grain}&from=${from}&to=${to}`,
    ), env);
    assert.equal(response.status, 200, `${grain} retention range should be accepted`);
  }
});

test('hourly series also uses a half-open time range', async () => {
  let prepared;
  const env = {
    DB: {
      prepare(sql) {
        prepared = { sql, bindings: null };
        return {
          bind(...bindings) { prepared.bindings = bindings; return this; },
          async all() { return { results: [] }; },
        };
      },
    },
  };
  const from = Date.UTC(2026, 6, 15) / 1000;
  const to = from + 86_400;

  const response = await worker.fetch(new Request(
    `https://example.test/v1/series?game_id=7&grain=hour&from=${from}&to=${to}`,
  ), env);

  assert.equal(response.status, 200);
  assert.match(prepared.sql, /captured_hour\s*>=\s*\?\s+AND\s+captured_hour\s*<\s*\?/i);
  assert.deepEqual(prepared.bindings, [7, from, to]);
});

function fakeMaintenanceDb({
  oldestDay = null,
  oldestHourly = oldestDay,
  oldestDaily = null,
  batchResults = [],
  batchError = null,
} = {}) {
  const calls = [];
  const statement = sql => ({
    bind(...bindings) {
      const call = { sql, bindings };
      calls.push(call);
      return {
        sql,
        bindings,
        async first() { return { oldest_hourly: oldestHourly, oldest_daily: oldestDaily }; },
        async run() { return {}; },
      };
    },
  });
  return {
    calls,
    batches: [],
    prepare: statement,
    async batch(statements) {
      this.batches.push(statements);
      if (batchError) throw batchError;
      return batchResults;
    },
  };
}

function maintenanceRequest(runId = 'run-1') {
  return new Request('https://example.test/v1/maintenance', {
    method: 'POST',
    headers: { 'X-Maintenance-Token': 'maintain-secret', 'X-Maintenance-Run': runId },
  });
}

test('oldest pending maintenance day chooses expired hourly before newer daily backlog', () => {
  const dailyCutoff = Date.UTC(2024, 6, 16) / 1000;
  const hourlyCutoff = Date.UTC(2026, 3, 17) / 1000;
  assert.equal(
    __test.oldestPendingDay({ oldest_hourly: dailyCutoff + 86_400, oldest_daily: dailyCutoff - 86_400 }, dailyCutoff, hourlyCutoff),
    dailyCutoff - 86_400,
  );
  assert.equal(
    __test.oldestPendingDay({ oldest_hourly: dailyCutoff + 86_400, oldest_daily: null }, dailyCutoff, hourlyCutoff),
    dailyCutoff + 86_400,
  );
  assert.equal(
    __test.oldestPendingDay({ oldest_hourly: hourlyCutoff, oldest_daily: null }, dailyCutoff, hourlyCutoff),
    null,
  );
});

test('maintenance handles only one UTC day and completes its audit in the mutation batch', async () => {
  const now = Math.floor(Date.now() / 1000);
  const processedDay = __test.maintenanceCutoffs(now, {}).hourly_cutoff - 86_400;
  const db = fakeMaintenanceDb({
    oldestDay: processedDay,
    batchResults: [
      { results: [{ row_count: 3 }] },
      { meta: { changes: 1 } },
      { meta: { changes: 2 } },
      { meta: { changes: 1 } },
      { meta: { changes: 1 } },
      { meta: { changes: 3 } },
      { meta: { changes: 1 } },
      { meta: { changes: 4 } },
      { meta: { changes: 0 } },
      { results: [{ has_more: 1 }] },
    ],
  });
  const response = await worker.fetch(maintenanceRequest(), {
    DB: db,
    MAINTENANCE_TOKEN: 'maintain-secret',
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.processed_day, processedDay);
  assert.equal(body.has_more, true);
  assert.equal(db.batches.length, 1);
  const completed = db.batches[0].find(item => /'completed'/.test(item.sql));
  const watermark = db.batches[0].find(item => /UPDATE history_retention_state/.test(item.sql));
  assert.ok(completed);
  assert.ok(watermark);
  assert.match(watermark.sql, /NOT EXISTS[\s\S]+captured_hour\s*<\s*\?/i);
  assert.equal(watermark.bindings[0], processedDay + 86_400);
  assert.match(db.batches[0].at(-1).sql, /has_more/i);
  const mutationSql = db.batches[0].map(item => item.sql).join('\n');
  assert.doesNotMatch(mutationSql, /DELETE FROM game_heat_hourly WHERE captured_hour\s*<\s*\?/i);
  assert.match(mutationSql, /captured_hour\s*>=\s*\?\s+AND\s+captured_hour\s*<\s*\?/i);
  assert.equal(
    db.calls.filter(call => /'completed'/.test(call.sql) && !db.batches[0].some(item => item.sql === call.sql)).length,
    0,
  );
});

test('maintenance day mutations all recheck that the selected hourly day is still oldest', async () => {
  const now = Math.floor(Date.now() / 1000);
  const processedDay = __test.maintenanceCutoffs(now, {}).hourly_cutoff - 86_400;
  const db = fakeMaintenanceDb({
    oldestDay: processedDay,
    batchResults: Array.from({ length: 10 }, (_, index) => (
      index === 9 ? { results: [{ has_more: 1 }] } : { meta: { changes: 0 } }
    )),
  });
  const response = await worker.fetch(maintenanceRequest('race-run'), {
    DB: db,
    MAINTENANCE_TOKEN: 'maintain-secret',
  });

  assert.equal(response.status, 200);
  for (const index of [0, 1, 2, 3, 4, 5, 6]) {
    assert.match(
      db.batches[0][index].sql,
      /NOT EXISTS[\s\S]+game_heat_hourly[\s\S]+captured_hour\s*<\s*\?/i,
      `statement ${index} must recheck oldest-hour ordering`,
    );
  }
});

test('maintenance never advances the archive watermark for a daily-only prune', async () => {
  const now = Math.floor(Date.now() / 1000);
  const processedDay = __test.maintenanceCutoffs(now, {}).daily_cutoff - 86_400;
  const db = fakeMaintenanceDb({
    oldestHourly: null,
    oldestDaily: processedDay,
    batchResults: [
      { results: [{ row_count: 0 }] },
      { meta: { changes: 1 } },
      { meta: { changes: 0 } },
      { meta: { changes: 1 } },
      { meta: { changes: 0 } },
      { results: [{ has_more: 0 }] },
    ],
  });
  const response = await worker.fetch(maintenanceRequest('daily-only'), {
    DB: db,
    MAINTENANCE_TOKEN: 'maintain-secret',
  });

  assert.equal(response.status, 200);
  assert.equal(db.batches.length, 1);
  assert.equal(
    db.batches[0].some(item => /UPDATE history_retention_state/.test(item.sql)),
    false,
  );
});

test('maintenance no-op records the run and prunes expired audit rows', async () => {
  const db = fakeMaintenanceDb({ oldestDay: null });
  const response = await worker.fetch(maintenanceRequest('empty-run'), {
    DB: db,
    MAINTENANCE_TOKEN: 'maintain-secret',
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.processed_day, null);
  assert.equal(body.has_more, false);
  assert.equal(db.batches.length, 1);
  const cleanup = db.batches[0].find(item => /DELETE FROM history_maintenance_runs/.test(item.sql));
  assert.ok(cleanup);
  assert.match(cleanup.sql, /started_at\s*<\s*\?/i);
  assert.equal(cleanup.bindings.length, 2);
  assert.equal(cleanup.bindings[1], 'empty-run');
});

test('maintenance deletes a bounded batch of events older than event retention', async () => {
  const db = fakeMaintenanceDb({
    oldestDay: null,
    batchResults: [
      { meta: { changes: 1 } },
      { meta: { changes: 0 } },
      { meta: { changes: 37 } },
      { results: [{ has_more: 0 }] },
    ],
  });
  const response = await worker.fetch(maintenanceRequest('event-prune'), {
    DB: db,
    MAINTENANCE_TOKEN: 'maintain-secret',
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.retention.event_days, 180);
  assert.equal(body.rows.events_deleted, 37);
  const cleanup = db.batches[0].find(item => /DELETE FROM game_change_events/.test(item.sql));
  assert.ok(cleanup);
  assert.match(cleanup.sql, /last_observed_at\s*<\s*\?/i);
  assert.match(cleanup.sql, /LIMIT\s*\?/i);
  assert.equal(cleanup.bindings.length, 2);
  assert.equal(cleanup.bindings[1], 5_000);
});

test('maintenance batch failure writes failed audit separately and never completed', async () => {
  const now = Math.floor(Date.now() / 1000);
  const processedDay = __test.maintenanceCutoffs(now, {}).hourly_cutoff - 86_400;
  const db = fakeMaintenanceDb({ oldestDay: processedDay, batchError: new Error('atomic rollback') });
  const response = await worker.fetch(maintenanceRequest('failed-run'), {
    DB: db,
    MAINTENANCE_TOKEN: 'maintain-secret',
  });

  assert.equal(response.status, 500);
  assert.equal(db.batches.length, 1);
  assert.equal(db.calls.some(call => /'completed'/.test(call.sql)), true);
  assert.equal(db.calls.some(call => /'failed'/.test(call.sql)), true);
  const completedStatement = db.calls.find(call => /'completed'/.test(call.sql));
  assert.equal(db.batches[0].some(item => item.sql === completedStatement.sql), true);
});
