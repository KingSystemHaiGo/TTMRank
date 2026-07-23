import { readBootstrap } from '../core/bootstrap.js';
import { fetchJsonWithRetry, immutableDataUrl } from '../core/data-fetch.js';

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

function validManifest(manifest) {
  return manifest?.schema_version === '2.0'
    && Number.isSafeInteger(manifest.observed_at)
    && validChangesFile(manifest.changes_file)
    && typeof manifest.changes_sha256 === 'string'
    && /^[a-f0-9]{64}$/i.test(manifest.changes_sha256);
}

function validViewInfo(info) {
  return info
    && validChangesFile(info.file)
    && typeof info.sha256 === 'string'
    && /^[a-f0-9]{64}$/i.test(info.sha256);
}

export function changeViewInfo(manifest, {
  view = 'full',
  range = '24h',
  scope = 'made',
} = {}) {
  let candidate = null;
  if (view === 'home') candidate = manifest?.changes_views?.home;
  else if (view === 'preview') candidate = manifest?.changes_views?.preview;
  else if (view === 'slice') candidate = manifest?.changes_views?.slices?.[range]?.[scope];
  if (validViewInfo(candidate)) return candidate;
  return {
    file: manifest.changes_file,
    sha256: manifest.changes_sha256,
    view: 'full',
    range: '7d',
    scope: 'all',
    count: Number(manifest.changes_event_count) || null,
    total: Number(manifest.changes_event_count) || null,
    complete: true,
  };
}

function manifestRequestUrl(nowMs) {
  const bucket = Math.floor(Number(nowMs) / (5 * 60_000));
  return `data/v2/manifest.json?v=${Number.isFinite(bucket) ? bucket : 0}`;
}

export function manifestVersion(manifest) {
  return `${manifest?.observed_at ?? ''}:${manifest?.changes_sha256 ?? ''}:${manifest?.changes_file ?? ''}`;
}

export async function loadManifest(fetcher = fetch, { nowMs = Date.now() } = {}) {
  const manifest = await fetchJsonWithRetry(manifestRequestUrl(nowMs), { fetcher, cache: 'no-store' });
  if (!validManifest(manifest)) throw new Error('变化数据清单格式无效');
  return manifest;
}

export async function loadFeed(manifest, fetcher = fetch, options = {}) {
  if (!validManifest(manifest)) throw new Error('变化数据清单格式无效');
  const publication = changeViewInfo(manifest, options);
  return validateChangeFeed(await fetchJsonWithRetry(
    immutableDataUrl(`data/v2/${publication.file}`, publication.sha256),
    { fetcher, cache: 'force-cache' },
  ));
}

export async function loadChanges(fetcher = fetch, options = {}) {
  const bootstrap = options.bootstrap ?? readBootstrap();
  if (validManifest(bootstrap?.manifest) && bootstrap?.changes) {
    const publication = changeViewInfo(bootstrap.manifest, {
      ...options,
      view: bootstrap.changes_view || options.view || 'full',
    });
    return { manifest: bootstrap.manifest, feed: validateChangeFeed(bootstrap.changes), publication };
  }
  const manifest = await loadManifest(fetcher, options);
  const publication = changeViewInfo(manifest, options);
  const feed = await loadFeed(manifest, fetcher, options);
  return { manifest, feed, publication };
}

export async function probeChanges(currentManifest, fetcher = fetch, options = {}) {
  const manifest = await loadManifest(fetcher, options);
  if (manifestVersion(manifest) === manifestVersion(currentManifest)) {
    return { changed: false, manifest, feed: null };
  }
  return {
    changed: true,
    manifest,
    feed: await loadFeed(manifest, fetcher, options),
    publication: changeViewInfo(manifest, options),
  };
}
