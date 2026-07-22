import { DEFAULT_CHANGE_FILTERS } from './model.js';

const RANGE_VALUES = new Set(['1h', '24h', '7d']);
const SCOPE_VALUES = new Set(['made', 'all']);
const TYPE_VALUES = new Set(['all', 'rank', 'appearance', 'score', 'coverage']);
const PLATFORM_VALUES = new Set(['all', 'android', 'ios']);

function cleanText(value, maximumLength) {
  return String(value || '').trim().slice(0, maximumLength);
}

export function parseChangeState(search = '') {
  const state = { ...DEFAULT_CHANGE_FILTERS };
  const params = search instanceof URLSearchParams
    ? search
    : new URLSearchParams(String(search).replace(/^\?/, ''));
  const range = params.get('range');
  const scope = params.get('scope');
  const type = params.get('type');
  const platform = params.get('platform');
  if (RANGE_VALUES.has(range)) state.range = range;
  if (SCOPE_VALUES.has(scope)) state.scope = scope;
  if (TYPE_VALUES.has(type)) state.type = type;
  if (PLATFORM_VALUES.has(platform)) state.platform = platform;
  if (params.has('query')) state.query = cleanText(params.get('query'), 80);
  if (params.has('event')) state.event = cleanText(params.get('event'), 160);
  return state;
}

export function serializeChangeState(input = DEFAULT_CHANGE_FILTERS) {
  const state = parseChangeState(new URLSearchParams(Object.entries(input)
    .filter(([, value]) => value !== null && value !== undefined)));
  const params = new URLSearchParams();
  for (const key of ['range', 'scope', 'type', 'platform', 'query', 'event']) {
    const value = state[key];
    if (value === DEFAULT_CHANGE_FILTERS[key] || value === '') continue;
    params.set(key, value);
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}
