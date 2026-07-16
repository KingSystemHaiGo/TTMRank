const DAY_SECONDS = 86_400;
const DEFAULT_HOURLY_RETENTION_DAYS = 90;
const DEFAULT_DAILY_RETENTION_DAYS = 730;

const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
});

const allowedOrigins = env => new Set((env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean));

function cors(request, env) {
  const origin = request.headers.get('Origin') || '';
  return allowedOrigins(env).has(origin)
    ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' }
    : {};
}

function validInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function validSnapshot(row) {
  if (!row || typeof row !== 'object') return null;
  const gameId = validInteger(row.game_id);
  const capturedHour = validInteger(row.captured_hour);
  const heat = validInteger(row.heat);
  const score = row.score == null ? null : Number(row.score);
  if (!gameId || !capturedHour || capturedHour % 3600 !== 0 || heat === null || heat < 0
    || score !== null && (!Number.isFinite(score) || score < 0 || score > 10)) return null;
  return { game_id: gameId, captured_hour: capturedHour, heat, score };
}

function retentionDays(value, fallback, minimum, maximum) {
  const parsed = validInteger(value);
  return parsed !== null && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

function maintenanceCutoffs(nowSeconds, env = {}) {
  const today = Math.floor(nowSeconds / DAY_SECONDS) * DAY_SECONDS;
  const hourlyDays = retentionDays(env.HOURLY_RETENTION_DAYS, DEFAULT_HOURLY_RETENTION_DAYS, 7, 365);
  const dailyDays = retentionDays(env.DAILY_RETENTION_DAYS, DEFAULT_DAILY_RETENTION_DAYS, hourlyDays + 1, 3650);
  return {
    today,
    hourly_days: hourlyDays,
    daily_days: dailyDays,
    hourly_cutoff: today - hourlyDays * DAY_SECONDS,
    daily_cutoff: today - dailyDays * DAY_SECONDS,
  };
}

function snapshotWindowError(snapshots, nowSeconds, env = {}, archivedThrough = 0) {
  const { hourly_cutoff: hourlyCutoff } = maintenanceCutoffs(nowSeconds, env);
  const latestAcceptedHour = Math.floor(nowSeconds / 3_600) * 3_600 + 3_600;
  if (snapshots.some(row => row.captured_hour < archivedThrough)) {
    return 'snapshot already archived';
  }
  if (snapshots.some(row => row.captured_hour < hourlyCutoff)) {
    return 'snapshot outside retained hourly window';
  }
  if (snapshots.some(row => row.captured_hour > latestAcceptedHour)) {
    return 'snapshot too far in the future';
  }
  return null;
}

function maintenanceRunId(request) {
  const supplied = request.headers.get('X-Maintenance-Run') || '';
  if (/^[A-Za-z0-9._:-]{1,128}$/.test(supplied)) return supplied;
  return crypto.randomUUID();
}

function databaseChanges(result) {
  const changes = Number(result?.meta?.changes ?? result?.changes ?? 0);
  return Number.isSafeInteger(changes) && changes >= 0 ? changes : 0;
}

function firstResultInteger(result, key) {
  const value = Number(result?.results?.[0]?.[key] ?? 0);
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function nullableInteger(value) {
  return value === null || value === undefined ? null : validInteger(value);
}

function oldestPendingDay(row, dailyCutoff, hourlyCutoff) {
  const oldestHourly = nullableInteger(row?.oldest_hourly);
  const oldestDaily = nullableInteger(row?.oldest_daily);
  const pending = [];
  if (oldestHourly !== null && oldestHourly < hourlyCutoff) {
    pending.push(Math.floor(oldestHourly / DAY_SECONDS) * DAY_SECONDS);
  }
  if (oldestDaily !== null && oldestDaily < dailyCutoff) {
    pending.push(Math.floor(oldestDaily / DAY_SECONDS) * DAY_SECONDS);
  }
  return pending.length ? Math.min(...pending) : null;
}
async function readLimitedBytes(response, limit) {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new Error('response too large');
    }
    chunks.push(value);
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

async function series(request, env, url) {
  const gameId = validInteger(url.searchParams.get('game_id'));
  const from = validInteger(url.searchParams.get('from'));
  const to = validInteger(url.searchParams.get('to'));
  const grain = url.searchParams.get('grain') || 'hour';
  const retention = maintenanceCutoffs(Math.floor(Date.now() / 1000), env);
  const maximumRange = grain === 'day'
    ? retention.daily_days * DAY_SECONDS
    : retention.hourly_days * DAY_SECONDS;
  const invalidDayBounds = grain === 'day' && (from % DAY_SECONDS !== 0 || to % DAY_SECONDS !== 0);
  if (!gameId || !from || !to || from >= to || !['hour', 'day'].includes(grain)
    || invalidDayBounds || to - from > maximumRange) {
    return json({ error: 'invalid series parameters' }, 400, cors(request, env));
  }

  const statement = grain === 'day'
    ? `WITH live_source AS (
        SELECT captured_hour, heat, score,
          ROW_NUMBER() OVER (
            PARTITION BY CAST(captured_hour / 86400 AS INTEGER)
            ORDER BY captured_hour DESC
          ) AS recency
        FROM game_heat_hourly
        WHERE game_id=? AND captured_hour >= ? AND captured_hour < ?
      ), live AS (
        SELECT CAST(captured_hour / 86400 AS INTEGER) * 86400 AS captured_day,
          CAST(ROUND(AVG(heat)) AS INTEGER) AS heat,
          CASE WHEN COUNT(score) > 0 THEN AVG(score) ELSE NULL END AS score,
          MIN(heat) AS heat_min,
          MAX(heat) AS heat_max,
          MAX(CASE WHEN recency = 1 THEN heat END) AS heat_last,
          COUNT(*) AS sample_count
        FROM live_source
        GROUP BY CAST(captured_hour / 86400 AS INTEGER)
      ), archived AS (
        SELECT captured_day,
          CAST(ROUND(1.0 * heat_sum / sample_count) AS INTEGER) AS heat,
          CASE WHEN score_sample_count > 0 THEN score_sum / score_sample_count ELSE NULL END AS score,
          heat_min, heat_max, heat_last, sample_count
        FROM game_heat_daily
        WHERE game_id=? AND captured_day >= ? AND captured_day < ?
      )
      SELECT captured_day, heat, score, heat_min, heat_max, heat_last, sample_count FROM live
      UNION ALL
      SELECT captured_day, heat, score, heat_min, heat_max, heat_last, sample_count
      FROM archived
      WHERE NOT EXISTS (
        SELECT 1 FROM live WHERE live.captured_day = archived.captured_day
      )
      ORDER BY captured_day`
    : `SELECT captured_hour, heat, score FROM game_heat_hourly
      WHERE game_id=? AND captured_hour >= ? AND captured_hour < ? ORDER BY captured_hour`;
  const bindings = grain === 'day' ? [gameId, from, to, gameId, from, to] : [gameId, from, to];
  const result = await env.DB.prepare(statement).bind(...bindings).all();
  return json({ game_id: gameId, grain, points: result.results }, 200, {
    ...cors(request, env),
    'Cache-Control': 'public, max-age=300',
  });
}

async function baselines(request, env, url) {
  const at = validInteger(url.searchParams.get('at')) || Math.floor(Date.now() / 1000);
  const ids = (url.searchParams.get('game_ids') || '').split(',').map(validInteger).filter(Boolean).slice(0, 100);
  if (!ids.length) return json({ error: 'game_ids required' }, 400, cors(request, env));
  const placeholders = ids.map(() => '?').join(',');
  const moments = [at - 3600, at - DAY_SECONDS, at - 7 * DAY_SECONDS];
  const result = await env.DB.prepare(`SELECT game_id,captured_hour,heat,score FROM game_heat_hourly WHERE game_id IN (${placeholders}) AND captured_hour BETWEEN ? AND ? ORDER BY captured_hour`)
    .bind(...ids, moments[2] - 43_200, at).all();
  return json({ at, points: result.results }, 200, cors(request, env));
}

async function ingest(request, env) {
  if (!env.INGEST_TOKEN || request.headers.get('X-Ingest-Token') !== env.INGEST_TOKEN) {
    return json({ error: 'unauthorized' }, 401, cors(request, env));
  }
  if (Number(request.headers.get('Content-Length') || 0) > 1_000_000) return json({ error: 'request too large' }, 413, cors(request, env));
  let bytes;
  try { bytes = await readLimitedBytes(request, 1_000_000); } catch { return json({ error: 'request too large' }, 413, cors(request, env)); }
  let body;
  try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { return json({ error: 'invalid JSON' }, 400, cors(request, env)); }
  if (!Array.isArray(body.snapshots) || body.snapshots.length > 2000) return json({ error: 'invalid snapshots' }, 400, cors(request, env));
  const snapshots = body.snapshots.map(validSnapshot);
  if (snapshots.some(row => !row)) return json({ error: 'invalid snapshot row' }, 400, cors(request, env));
  const retentionState = await env.DB.prepare(`SELECT archived_through
      FROM history_retention_state WHERE singleton=1`).first();
  const archivedThrough = nullableInteger(retentionState?.archived_through) ?? 0;
  const windowError = snapshotWindowError(snapshots, Math.floor(Date.now() / 1000), env, archivedThrough);
  if (windowError) {
    return json({ error: windowError }, windowError === 'snapshot already archived' ? 409 : 400, cors(request, env));
  }
  const statements = snapshots.map(row => env.DB.prepare(`INSERT INTO game_heat_hourly(game_id,captured_hour,heat,score)
      VALUES(?,?,?,?) ON CONFLICT(game_id,captured_hour)
      DO UPDATE SET heat=excluded.heat,score=excluded.score`)
    .bind(row.game_id, row.captured_hour, row.heat, row.score));
  try {
    await env.DB.batch(statements);
  } catch (error) {
    if (String(error?.message || error).includes('TTMRANK_ARCHIVED_HOUR')) {
      return json({ error: 'snapshot already archived' }, 409, cors(request, env));
    }
    throw error;
  }
  return json({ ok: true, written: statements.length }, 200, cors(request, env));
}

const COMPACT_DAILY_SQL = `INSERT INTO game_heat_daily (
    game_id, captured_day, first_captured_hour, last_captured_hour,
    sample_count, heat_min, heat_max, heat_sum, heat_last,
    score_sample_count, score_min, score_max, score_sum, score_last, updated_at
  )
  SELECT
    source.game_id,
    CAST(source.captured_hour / 86400 AS INTEGER) * 86400 AS captured_day,
    MIN(source.captured_hour),
    MAX(source.captured_hour),
    COUNT(*),
    MIN(source.heat),
    MAX(source.heat),
    SUM(source.heat),
    (SELECT latest.heat FROM game_heat_hourly AS latest
      WHERE latest.game_id = source.game_id
        AND CAST(latest.captured_hour / 86400 AS INTEGER) = CAST(source.captured_hour / 86400 AS INTEGER)
        AND latest.captured_hour >= ? AND latest.captured_hour < ?
      ORDER BY latest.captured_hour DESC LIMIT 1),
    COUNT(source.score),
    MIN(source.score),
    MAX(source.score),
    COALESCE(SUM(source.score), 0),
    (SELECT latest.score FROM game_heat_hourly AS latest
      WHERE latest.game_id = source.game_id
        AND CAST(latest.captured_hour / 86400 AS INTEGER) = CAST(source.captured_hour / 86400 AS INTEGER)
        AND latest.captured_hour >= ? AND latest.captured_hour < ?
      ORDER BY latest.captured_hour DESC LIMIT 1),
    ?
  FROM game_heat_hourly AS source
  WHERE source.captured_hour >= ? AND source.captured_hour < ?
    AND NOT EXISTS (
      SELECT 1 FROM game_heat_hourly WHERE captured_hour < ?
    )
  GROUP BY source.game_id, CAST(source.captured_hour / 86400 AS INTEGER)
  ON CONFLICT(game_id, captured_day) DO UPDATE SET
    first_captured_hour = excluded.first_captured_hour,
    last_captured_hour = excluded.last_captured_hour,
    sample_count = excluded.sample_count,
    heat_min = excluded.heat_min,
    heat_max = excluded.heat_max,
    heat_sum = excluded.heat_sum,
    heat_last = excluded.heat_last,
    score_sample_count = excluded.score_sample_count,
    score_min = excluded.score_min,
    score_max = excluded.score_max,
    score_sum = excluded.score_sum,
    score_last = excluded.score_last,
    updated_at = excluded.updated_at`;

const CLEAR_DAILY_DAY_SQL = `DELETE FROM game_heat_daily
  WHERE captured_day = ?
    AND EXISTS (
      SELECT 1 FROM game_heat_hourly
      WHERE captured_hour >= ? AND captured_hour < ?
    )
    AND NOT EXISTS (
      SELECT 1 FROM game_heat_hourly WHERE captured_hour < ?
    )`;

const DELETE_HOURLY_DAY_SQL = `DELETE FROM game_heat_hourly
  WHERE captured_hour >= ? AND captured_hour < ?
    AND NOT EXISTS (
      SELECT 1 FROM game_heat_hourly AS earlier WHERE earlier.captured_hour < ?
    )`;

const DELETE_DAILY_DAY_SQL = `DELETE FROM game_heat_daily
  WHERE captured_day >= ? AND captured_day < ? AND captured_day < ?
    AND NOT EXISTS (
      SELECT 1 FROM game_heat_hourly WHERE captured_hour < ?
    )`;

const FIND_OLDEST_PENDING_SQL = `SELECT
    (SELECT MIN(captured_hour) FROM game_heat_hourly WHERE captured_hour < ?) AS oldest_hourly,
    (SELECT MIN(captured_day) FROM game_heat_daily WHERE captured_day < ?) AS oldest_daily`;

const HAS_MORE_SQL = `SELECT CASE WHEN
    EXISTS (SELECT 1 FROM game_heat_hourly WHERE captured_hour < ?)
    OR EXISTS (SELECT 1 FROM game_heat_daily WHERE captured_day < ?)
  THEN 1 ELSE 0 END AS has_more`;

const PRUNE_MAINTENANCE_RUNS_SQL = `DELETE FROM history_maintenance_runs
  WHERE started_at < ? AND run_id <> ?`;

const ADVANCE_ARCHIVED_THROUGH_SQL = `UPDATE history_retention_state
  SET archived_through = MAX(archived_through, ?)
  WHERE singleton = 1
    AND EXISTS (
      SELECT 1 FROM game_heat_hourly
      WHERE captured_hour >= ? AND captured_hour < ?
    )
    AND NOT EXISTS (
      SELECT 1 FROM game_heat_hourly WHERE captured_hour < ?
    )`;

async function maintain(request, env) {
  if (!env.MAINTENANCE_TOKEN || request.headers.get('X-Maintenance-Token') !== env.MAINTENANCE_TOKEN) {
    return json({ error: 'unauthorized' }, 401, cors(request, env));
  }

  const now = Math.floor(Date.now() / 1000);
  const runId = maintenanceRunId(request);
  const cutoffs = maintenanceCutoffs(now, env);

  try {
    const oldest = await env.DB.prepare(FIND_OLDEST_PENDING_SQL)
      .bind(cutoffs.hourly_cutoff, cutoffs.daily_cutoff).first();
    const processedDay = oldestPendingDay(oldest, cutoffs.daily_cutoff, cutoffs.hourly_cutoff);
    if (processedDay === null) {
      const completedAt = Math.floor(Date.now() / 1000);
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO history_maintenance_runs
            (run_id,started_at,completed_at,status,hourly_cutoff,daily_cutoff)
            VALUES(?,?,?,'completed',?,?)
            ON CONFLICT(run_id) DO UPDATE SET
              started_at=excluded.started_at,completed_at=excluded.completed_at,status='completed',
              hourly_cutoff=excluded.hourly_cutoff,daily_cutoff=excluded.daily_cutoff,
              hourly_rows_archived=0,hourly_rows_deleted=0,daily_rows_deleted=0,error=NULL`)
          .bind(runId, now, completedAt, cutoffs.hourly_cutoff, cutoffs.daily_cutoff),
        env.DB.prepare(PRUNE_MAINTENANCE_RUNS_SQL).bind(cutoffs.daily_cutoff, runId),
      ]);
      return json({
        ok: true,
        run_id: runId,
        processed_day: null,
        has_more: false,
        retention: { hourly_days: cutoffs.hourly_days, daily_days: cutoffs.daily_days },
        cutoffs: { hourly: cutoffs.hourly_cutoff, daily: cutoffs.daily_cutoff },
        rows: { hourly_archived: 0, hourly_deleted: 0, daily_deleted: 0 },
      }, 200, cors(request, env));
    }

    const nextDay = processedDay + DAY_SECONDS;
    const oldestHourly = nullableInteger(oldest?.oldest_hourly);
    const selectedHourlyDay = oldestHourly !== null
      && oldestHourly < cutoffs.hourly_cutoff
      && Math.floor(oldestHourly / DAY_SECONDS) * DAY_SECONDS === processedDay;
    const archiveDay = processedDay >= cutoffs.daily_cutoff && processedDay < cutoffs.hourly_cutoff;
    const completedAt = Math.floor(Date.now() / 1000);
    const statements = [
      env.DB.prepare(`SELECT CASE WHEN NOT EXISTS (
          SELECT 1 FROM game_heat_hourly WHERE captured_hour < ?
        ) THEN (
          SELECT COUNT(*) FROM game_heat_hourly
          WHERE captured_hour >= ? AND captured_hour < ?
        ) ELSE 0 END AS row_count`)
        .bind(processedDay, processedDay, nextDay),
    ];
    if (archiveDay) {
      statements.push(
        env.DB.prepare(CLEAR_DAILY_DAY_SQL).bind(processedDay, processedDay, nextDay, processedDay),
        env.DB.prepare(COMPACT_DAILY_SQL).bind(
          processedDay, nextDay,
          processedDay, nextDay,
          now, processedDay, nextDay, processedDay,
        ),
      );
    }
    statements.push(
      env.DB.prepare(`INSERT INTO history_maintenance_runs
          (run_id,started_at,completed_at,status,hourly_cutoff,daily_cutoff,
           hourly_rows_archived,hourly_rows_deleted,daily_rows_deleted,error)
        SELECT ?,?,?,'completed',?,?,
          CASE WHEN ? = 1 THEN (
            SELECT COUNT(*) FROM game_heat_hourly WHERE captured_hour >= ? AND captured_hour < ?
              AND NOT EXISTS (
                SELECT 1 FROM game_heat_hourly WHERE captured_hour < ?
              )
          ) ELSE 0 END,
          CASE WHEN ? = 1 THEN (
            SELECT COUNT(*) FROM game_heat_hourly WHERE captured_hour >= ? AND captured_hour < ?
              AND NOT EXISTS (
                SELECT 1 FROM game_heat_hourly WHERE captured_hour < ?
              )
          ) ELSE 0 END,
          (
            SELECT COUNT(*) FROM game_heat_daily
            WHERE captured_day >= ? AND captured_day < ? AND captured_day < ?
              AND NOT EXISTS (
                SELECT 1 FROM game_heat_hourly WHERE captured_hour < ?
              )
          ),NULL
        ON CONFLICT(run_id) DO UPDATE SET
          started_at=excluded.started_at,completed_at=excluded.completed_at,status='completed',
          hourly_cutoff=excluded.hourly_cutoff,daily_cutoff=excluded.daily_cutoff,
          hourly_rows_archived=excluded.hourly_rows_archived,
          hourly_rows_deleted=excluded.hourly_rows_deleted,
          daily_rows_deleted=excluded.daily_rows_deleted,error=NULL`)
        .bind(
          runId, now, completedAt, cutoffs.hourly_cutoff, cutoffs.daily_cutoff,
          archiveDay ? 1 : 0, processedDay, nextDay, processedDay,
          selectedHourlyDay ? 1 : 0, processedDay, nextDay, processedDay,
          processedDay, nextDay, cutoffs.daily_cutoff,
          selectedHourlyDay ? processedDay : nextDay,
        ),
    );
    if (selectedHourlyDay) {
      statements.push(
        env.DB.prepare(ADVANCE_ARCHIVED_THROUGH_SQL)
          .bind(nextDay, processedDay, nextDay, processedDay),
        env.DB.prepare(DELETE_HOURLY_DAY_SQL).bind(processedDay, nextDay, processedDay),
      );
    }
    statements.push(
      env.DB.prepare(DELETE_DAILY_DAY_SQL).bind(
        processedDay, nextDay, cutoffs.daily_cutoff,
        selectedHourlyDay ? processedDay : nextDay,
      ),
      env.DB.prepare(PRUNE_MAINTENANCE_RUNS_SQL)
        .bind(cutoffs.daily_cutoff, runId),
      env.DB.prepare(HAS_MORE_SQL).bind(cutoffs.hourly_cutoff, cutoffs.daily_cutoff),
    );
    // D1 batches are atomic: aggregate, source deletion and completed audit
    // either all commit for this UTC day or none do.
    const results = await env.DB.batch(statements);
    const archivedRows = firstResultInteger(results[0], 'row_count');
    const watermarkIndex = archiveDay ? 4 : 2;
    const hourlyDeleteIndex = selectedHourlyDay ? watermarkIndex + 1 : -1;
    const dailyDeleteIndex = selectedHourlyDay ? hourlyDeleteIndex + 1 : watermarkIndex;
    const hourlyRowsDeleted = selectedHourlyDay ? databaseChanges(results[hourlyDeleteIndex]) : 0;
    const dailyRowsDeleted = databaseChanges(results[dailyDeleteIndex]);
    const hasMore = firstResultInteger(results.at(-1), 'has_more') === 1;
    return json({
      ok: true,
      run_id: runId,
      processed_day: processedDay,
      has_more: hasMore,
      retention: { hourly_days: cutoffs.hourly_days, daily_days: cutoffs.daily_days },
      cutoffs: { hourly: cutoffs.hourly_cutoff, daily: cutoffs.daily_cutoff },
      rows: {
        hourly_archived: archiveDay ? archivedRows : 0,
        hourly_deleted: hourlyRowsDeleted,
        daily_deleted: dailyRowsDeleted,
      },
    }, 200, cors(request, env));
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : 'maintenance failed';
    await env.DB.prepare(`INSERT INTO history_maintenance_runs
        (run_id,started_at,completed_at,status,hourly_cutoff,daily_cutoff,error)
        VALUES(?,?,?,'failed',?,?,?)
        ON CONFLICT(run_id) DO UPDATE SET
          started_at=excluded.started_at,completed_at=excluded.completed_at,status='failed',
          hourly_cutoff=excluded.hourly_cutoff,daily_cutoff=excluded.daily_cutoff,
          hourly_rows_archived=0,hourly_rows_deleted=0,daily_rows_deleted=0,error=excluded.error`)
      .bind(
        runId, now, Math.floor(Date.now() / 1000),
        cutoffs.hourly_cutoff, cutoffs.daily_cutoff, message,
      ).run();
    return json({ error: 'maintenance failed', run_id: runId }, 500, cors(request, env));
  }
}

async function icon(request, env, url) {
  let source;
  try { source = new URL(url.searchParams.get('url') || ''); } catch { return json({ error: 'invalid icon URL' }, 400, cors(request, env)); }
  if (source.protocol !== 'https:' || source.hostname !== 'img-tc.tapimg.com') return json({ error: 'icon host not allowed' }, 403, cors(request, env));
  const cache = await caches.open('ttmrank-icons');
  const key = new Request(url.toString(), { method: 'GET' });
  const cached = await cache.match(key);
  if (cached) return cached;
  const upstream = await fetch(source.toString(), { headers: { Referer: 'https://www.taptap.cn/' }, redirect: 'manual' });
  const type = upstream.headers.get('Content-Type') || '';
  const length = Number(upstream.headers.get('Content-Length') || 0);
  if (!upstream.ok || !type.startsWith('image/') || length > 2_000_000) return json({ error: 'invalid upstream image' }, 502, cors(request, env));
  let bytes;
  try { bytes = await readLimitedBytes(upstream, 2_000_000); } catch { return json({ error: 'upstream image too large' }, 502, cors(request, env)); }
  const response = new Response(bytes, { status: 200, headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=31536000, immutable', 'Access-Control-Allow-Origin': '*', 'Cross-Origin-Resource-Policy': 'cross-origin' } });
  await cache.put(key, response.clone());
  return response;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...cors(request, env), 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,X-Ingest-Token,X-Maintenance-Token,X-Maintenance-Run' } });
    if (url.pathname === '/v1/series' && request.method === 'GET') return series(request, env, url);
    if (url.pathname === '/v1/baselines' && request.method === 'GET') return baselines(request, env, url);
    if (url.pathname === '/v1/snapshots' && request.method === 'POST') return ingest(request, env);
    if (url.pathname === '/v1/maintenance' && request.method === 'POST') return maintain(request, env);
    if (url.pathname === '/v1/icon' && request.method === 'GET') return icon(request, env, url);
    return json({ error: 'not found' }, 404, cors(request, env));
  },
};

export const __test = {
  allowedOrigins,
  databaseChanges,
  firstResultInteger,
  maintenanceCutoffs,
  maintenanceRunId,
  oldestPendingDay,
  readLimitedBytes,
  snapshotWindowError,
  validInteger,
  validSnapshot,
};
