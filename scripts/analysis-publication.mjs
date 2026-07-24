const GAME_FIELDS = Object.freeze([
  'id',
  'title',
  'url',
  'developer',
  'tags',
  'released_at',
  'score',
  'heat',
  'is_taptap_made',
  'observed_at',
]);

const APPEARANCE_FIELDS = Object.freeze([
  'game_id',
  'platform',
  'chart',
  'rank',
]);

const METRIC_FIELDS = Object.freeze([
  'game_id',
  'age_hours',
  'heat_per_day_lifetime',
  'heat_delta_1h',
  'heat_delta_1h_estimated',
  'heat_delta_1h_basis_hours',
  'heat_delta_24h',
  'heat_delta_7d',
  'growth_per_hour_24h',
  'chart_coverage',
  'platform_coverage',
  'history_available',
]);

function project(record, fields) {
  return Object.fromEntries(fields
    .filter(field => record[field] !== undefined)
    .map(field => [field, record[field]]));
}

export function buildWebAnalysis(full) {
  if (full?.schema_version !== '2.0'
      || !Array.isArray(full.games)
      || !Array.isArray(full.appearances)
      || !Array.isArray(full.metrics)) {
    throw new TypeError('invalid analysis payload');
  }
  return {
    schema_version: full.schema_version,
    updated_at: full.updated_at,
    observed_at: full.observed_at,
    games: full.games.map(game => project(game, GAME_FIELDS)),
    appearances: full.appearances.map(row => project(row, APPEARANCE_FIELDS)),
    metrics: full.metrics.map(metric => project(metric, METRIC_FIELDS)),
  };
}
