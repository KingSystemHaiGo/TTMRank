export const DEFAULT_FILTERS = Object.freeze({
  scope: 'all', platform: 'all', charts: [], tags: [], tagMode: 'or', released: 'all', releasedFrom: null, releasedTo: null,
  heatMin: null, heatMax: null, dailyHeatMin: null, dailyHeatMax: null, growth24hMin: null, growth24hMax: null, scoreMin: null, scoreMax: null, rankMin: null, rankMax: null,
  query: '', sort: 'heat_desc', baseline: 'dynamic', highScore: 8.5,
});

function releasedRange(filters, observedAt) {
  if (filters.releasedFrom || filters.releasedTo) return [filters.releasedFrom, filters.releasedTo];
  const match = /^(\d+)(h|d)$/.exec(filters.released || '');
  if (!match) return [null, null];
  const seconds = Number(match[1]) * (match[2] === 'd' ? 86400 : 3600);
  return [observedAt - seconds, observedAt];
}

function within(value, min, max) {
  if (min !== null && min !== undefined && (value === null || value === undefined || value < min)) return false;
  if (max !== null && max !== undefined && (value === null || value === undefined || value > max)) return false;
  return true;
}

export function applyFilters(data, filters = DEFAULT_FILTERS) {
  const metrics = new Map(data.metrics.map(metric => [metric.game_id, metric]));
  const appearancesByGame = new Map();
  data.appearances.forEach(row => {
    if (!appearancesByGame.has(row.game_id)) appearancesByGame.set(row.game_id, []);
    appearancesByGame.get(row.game_id).push(row);
  });
  const [releasedFrom, releasedTo] = releasedRange(filters, data.observed_at);
  const query = (filters.query || '').trim().toLocaleLowerCase('zh-CN');

  const games = data.games.filter(game => {
    if (filters.scope === 'made' && !game.is_taptap_made) return false;
    const rows = (appearancesByGame.get(game.id) || []).filter(row => filters.platform === 'all' || row.platform === filters.platform);
    if (!rows.length) return false;
    if (filters.charts.length && !rows.some(row => filters.charts.includes(row.chart))) return false;
    if (!rows.some(row => within(row.rank, filters.rankMin, filters.rankMax))) return false;
    if (releasedFrom && (!game.released_at || game.released_at < releasedFrom)) return false;
    if (releasedTo && (!game.released_at || game.released_at > releasedTo)) return false;
    if (!within(game.heat, filters.heatMin, filters.heatMax) || !within(game.score, filters.scoreMin, filters.scoreMax)) return false;
    const metric = metrics.get(game.id) || {};
    if (!within(metric.heat_per_day_lifetime, filters.dailyHeatMin, filters.dailyHeatMax)) return false;
    if (!within(metric.growth_per_hour_24h, filters.growth24hMin, filters.growth24hMax)) return false;
    if (filters.tags.length) {
      const matches = filters.tags.map(tag => (game.tags || []).includes(tag));
      if (filters.tagMode === 'and' ? !matches.every(Boolean) : !matches.some(Boolean)) return false;
    }
    if (query && !`${game.title} ${(game.tags || []).join(' ')}`.toLocaleLowerCase('zh-CN').includes(query)) return false;
    return true;
  });
  const ids = new Set(games.map(game => game.id));
  return {
    ...data,
    games,
    metrics: data.metrics.filter(metric => ids.has(metric.game_id)),
    appearances: data.appearances.filter(row => ids.has(row.game_id) && (filters.platform === 'all' || row.platform === filters.platform)),
  };
}
