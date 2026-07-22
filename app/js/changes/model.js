const RANGE_SECONDS = Object.freeze({
  '1h': 3_600,
  '24h': 24 * 3_600,
  '7d': 7 * 86_400,
});

const TYPE_KINDS = Object.freeze({
  rank: new Set(['rank_rise', 'rank_fall']),
  appearance: new Set(['entered', 'reentered', 'exited']),
  score: new Set(['score_rise', 'score_fall']),
  coverage: new Set(['coverage_increase', 'coverage_decrease']),
});

const POSITIVE_KINDS = new Set([
  'rank_rise',
  'entered',
  'reentered',
  'score_rise',
  'coverage_increase',
]);
const NEGATIVE_KINDS = new Set([
  'rank_fall',
  'exited',
  'score_fall',
  'coverage_decrease',
]);

export const DEFAULT_CHANGE_FILTERS = Object.freeze({
  range: '24h',
  scope: 'made',
  type: 'all',
  platform: 'all',
  query: '',
  event: '',
});

export const CHANGE_TYPE_OPTIONS = Object.freeze([
  ['all', '全部变化'],
  ['rank', '排名变化'],
  ['appearance', '进出榜'],
  ['score', '评分变化'],
  ['coverage', '榜单覆盖'],
]);

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function integer(value) {
  const number = finiteNumber(value);
  return number === null ? null : Math.trunc(number);
}

function score(value) {
  const number = finiteNumber(value);
  return number === null ? null : number.toFixed(1);
}

export function eventTimestamp(event) {
  const timestamp = Number(event?.last_observed_at ?? event?.observed_at);
  return Number.isSafeInteger(timestamp) ? timestamp : 0;
}

export function eventTone(kind) {
  if (POSITIVE_KINDS.has(kind)) return 'positive';
  if (NEGATIVE_KINDS.has(kind)) return 'negative';
  return 'neutral';
}

export function describeEvent(event = {}) {
  const beforeInteger = integer(event.before);
  const afterInteger = integer(event.after);
  const beforeScore = score(event.before);
  const afterScore = score(event.after);
  switch (event.kind) {
    case 'rank_rise':
      return beforeInteger !== null && afterInteger !== null
        ? `从第${beforeInteger}名升至第${afterInteger}名`
        : '记录到一项排名变化';
    case 'rank_fall':
      return beforeInteger !== null && afterInteger !== null
        ? `从第${beforeInteger}名降至第${afterInteger}名`
        : '记录到一项排名变化';
    case 'entered':
      return afterInteger !== null ? `首次进入榜单，位列第${afterInteger}名` : '首次进入榜单';
    case 'reentered':
      return afterInteger !== null ? `重新进入榜单，位列第${afterInteger}名` : '重新进入榜单';
    case 'exited':
      return beforeInteger !== null ? `跌出榜单，此前位列第${beforeInteger}名` : '跌出榜单';
    case 'score_rise':
      return beforeScore !== null && afterScore !== null
        ? `评分从${beforeScore}升至${afterScore}`
        : '记录到一项评分变化';
    case 'score_fall':
      return beforeScore !== null && afterScore !== null
        ? `评分从${beforeScore}降至${afterScore}`
        : '记录到一项评分变化';
    case 'coverage_increase':
      return beforeInteger !== null && afterInteger !== null
        ? `榜单覆盖从${beforeInteger}个增至${afterInteger}个`
        : '榜单覆盖增加';
    case 'coverage_decrease':
      return beforeInteger !== null && afterInteger !== null
        ? `榜单覆盖从${beforeInteger}个减至${afterInteger}个`
        : '榜单覆盖减少';
    default:
      return '记录到一项变化';
  }
}

function matchesType(kind, type) {
  if (!type || type === 'all') return true;
  if (TYPE_KINDS[type]) return TYPE_KINDS[type].has(kind);
  return kind === type;
}

export function filterEvents(events, filters = DEFAULT_CHANGE_FILTERS, generatedAt = 0) {
  const rangeSeconds = RANGE_SECONDS[filters.range] ?? RANGE_SECONDS['24h'];
  const now = Number.isSafeInteger(Number(generatedAt)) ? Number(generatedAt) : 0;
  const cutoff = now - rangeSeconds;
  const query = String(filters.query || '').trim().toLocaleLowerCase('zh-CN');
  return (Array.isArray(events) ? events : []).filter(event => {
    if (eventTimestamp(event) < cutoff) return false;
    if (filters.scope !== 'all' && event.scope !== filters.scope) return false;
    if (!matchesType(event.kind, filters.type)) return false;
    if (filters.platform && filters.platform !== 'all' && event.platform !== filters.platform) return false;
    if (query && !String(event.game_title || '').toLocaleLowerCase('zh-CN').includes(query)) return false;
    return true;
  });
}

export function topEvents(events, limit = 5) {
  const boundedLimit = Math.max(0, Math.trunc(Number(limit) || 0));
  return [...(Array.isArray(events) ? events : [])]
    .sort((left, right) => {
      const importance = Number(right.importance || 0) - Number(left.importance || 0);
      if (importance) return importance;
      const recency = eventTimestamp(right) - eventTimestamp(left);
      if (recency) return recency;
      const leftId = String(left.id || '');
      const rightId = String(right.id || '');
      return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
    })
    .slice(0, boundedLimit || 5);
}
