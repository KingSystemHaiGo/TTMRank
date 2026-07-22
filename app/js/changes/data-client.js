const FEED_STATUSES = new Set(['baseline', 'ready', 'partial', 'error']);

function validEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return false;
  const timestamp = event.last_observed_at ?? event.observed_at;
  return typeof event.id === 'string'
    && event.id.length > 0
    && typeof event.kind === 'string'
    && event.kind.length > 0
    && ['made', 'all'].includes(event.scope)
    && Number.isSafeInteger(event.game_id)
    && typeof event.game_title === 'string'
    && Number.isSafeInteger(timestamp)
    && Number.isFinite(Number(event.importance));
}

export function validateChangeFeed(feed) {
  if (!feed || typeof feed !== 'object' || feed.schema_version !== '1.0') {
    throw new Error(`不支持的变化数据版本 ${feed?.schema_version ?? 'unknown'}`);
  }
  if (!Number.isSafeInteger(feed.generated_at)
    || typeof feed.updated_at !== 'string'
    || !FEED_STATUSES.has(feed.status)
    || typeof feed.comparison_available !== 'boolean'
    || typeof feed.partial !== 'boolean'
    || !Number.isSafeInteger(feed.suppressed_negative_event_count)
    || feed.suppressed_negative_event_count < 0
    || !Array.isArray(feed.events)) {
    throw new Error('变化数据格式无效');
  }
  if (!feed.events.every(validEvent)) throw new Error('变化事件格式无效');
  return feed;
}

function validChangesFile(value) {
  return typeof value === 'string'
    && /^[a-z0-9][a-z0-9._-]*\.json$/i.test(value)
    && !value.includes('..');
}

export async function loadChanges(fetcher = fetch) {
  const manifestResponse = await fetcher('data/v2/manifest.json', { cache: 'no-cache' });
  if (!manifestResponse.ok) throw new Error(`manifest HTTP ${manifestResponse.status}`);
  const manifest = await manifestResponse.json();
  if (manifest?.schema_version !== '2.0' || !validChangesFile(manifest.changes_file)) {
    throw new Error('变化数据清单格式无效');
  }
  const response = await fetcher(`data/v2/${manifest.changes_file}`, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`changes HTTP ${response.status}`);
  const feed = validateChangeFeed(await response.json());
  return { manifest, feed };
}
