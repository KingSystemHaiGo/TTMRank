const ARRAY_KEYS = new Set(['charts', 'tags']);
const NUMBER_KEYS = new Set(['heatMin', 'heatMax', 'dailyHeatMin', 'dailyHeatMax', 'growth24hMin', 'growth24hMax', 'scoreMin', 'scoreMax', 'rankMin', 'rankMax', 'releasedFrom', 'releasedTo']);

function valuesEqual(left, right) {
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => value === right[index]);
  }
  return left === right;
}

export function serializeState(state, defaults = null) {
  const params = new URLSearchParams();
  Object.entries(state).forEach(([key, value]) => {
    if (value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length)) return;
    if (defaults && key in defaults && valuesEqual(value, defaults[key])) return;
    params.set(key, Array.isArray(value) ? value.join(',') : String(value));
  });
  const query = params.toString();
  return query ? `?${query}` : '';
}

export function parseState(search, defaults = null) {
  const base = defaults || {
    scope: 'all', platform: 'all', charts: [], tags: [], tagMode: 'or', released: 'all', releasedFrom: null, releasedTo: null,
    heatMin: null, heatMax: null, dailyHeatMin: null, dailyHeatMax: null, growth24hMin: null, growth24hMax: null, scoreMin: null, scoreMax: null, rankMin: null, rankMax: null,
    query: '', sort: 'heat_desc', baseline: 'dynamic', highScore: 8.5,
  };
  const state = { ...base, charts: [...base.charts], tags: [...base.tags] };
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  params.forEach((value, key) => {
    if (!(key in state)) return;
    if (ARRAY_KEYS.has(key)) state[key] = value ? value.split(',').filter(Boolean) : [];
    else if (NUMBER_KEYS.has(key) || key === 'highScore') state[key] = value === '' ? null : Number(value);
    else state[key] = value;
  });
  return state;
}
