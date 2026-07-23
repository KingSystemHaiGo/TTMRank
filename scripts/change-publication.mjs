const RANGE_SECONDS = Object.freeze({
  '1h': 3_600,
  '24h': 86_400,
  '7d': 604_800,
});

const RANGES = Object.freeze(Object.keys(RANGE_SECONDS));
const SCOPES = Object.freeze(['made', 'all']);

function eventTimestamp(event) {
  const value = Number(event?.last_observed_at ?? event?.observed_at);
  return Number.isSafeInteger(value) ? value : 0;
}

function copyFeed(feed, events) {
  return { ...feed, events };
}

function recentFirst(left, right) {
  const recency = eventTimestamp(right) - eventTimestamp(left);
  if (recency) return recency;
  const importance = Number(right.importance || 0) - Number(left.importance || 0);
  if (importance) return importance;
  return String(left.id || '').localeCompare(String(right.id || ''));
}

function importantFirst(left, right) {
  const importance = Number(right.importance || 0) - Number(left.importance || 0);
  return importance || recentFirst(left, right);
}

function selectEvents(feed, range, scope) {
  const cutoff = Number(feed.generated_at) - RANGE_SECONDS[range];
  return feed.events
    .filter(event => eventTimestamp(event) >= cutoff && (scope === 'all' || event.scope === 'made'))
    .sort(recentFirst);
}

export function buildChangePublication(feed, { previewLimit = 40, homeLimit = 5 } = {}) {
  if (!feed || !Array.isArray(feed.events)) throw new Error('change feed is invalid');
  const slices = {};
  for (const range of RANGES) {
    slices[range] = {};
    for (const scope of SCOPES) {
      slices[range][scope] = copyFeed(feed, selectEvents(feed, range, scope));
    }
  }

  const homeById = new Map();
  for (const range of RANGES) {
    for (const event of [...slices[range].made.events].sort(importantFirst).slice(0, homeLimit)) {
      homeById.set(event.id, event);
    }
  }
  const home = copyFeed(feed, [...homeById.values()].sort(recentFirst));
  const defaultEvents = slices['24h'].made.events;
  const preview = copyFeed(feed, defaultEvents.slice(0, previewLimit));

  return {
    home,
    preview,
    previewTotal: defaultEvents.length,
    previewComplete: defaultEvents.length <= previewLimit,
    slices,
  };
}
