const ARRAY_KEYS = new Set(['charts', 'tags']);
const NUMBER_KEYS = new Set(['heatMin', 'heatMax', 'dailyHeatMin', 'dailyHeatMax', 'scoreMin', 'scoreMax', 'rankMin', 'rankMax', 'releasedFrom', 'releasedTo']);

export function serializeState(state) {
  const params = new URLSearchParams();
  Object.entries(state).forEach(([key, value]) => {
    if (value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length)) return;
    params.set(key, Array.isArray(value) ? value.join(',') : String(value));
  });
  return `?${params.toString()}`;
}

export function parseState(search, defaults = null) {
  const base = defaults || {
    scope: 'all', platform: 'all', charts: [], tags: [], tagMode: 'or', released: 'all', releasedFrom: null, releasedTo: null,
    heatMin: null, heatMax: null, dailyHeatMin: null, dailyHeatMax: null, scoreMin: null, scoreMax: null, rankMin: null, rankMax: null,
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

