import { median, percentileRank } from '../core/statistics.js';

export function latestReleasedGames(games, observedAt, limit = 6) {
  const ceiling = Number(observedAt);
  const boundedLimit = Math.max(0, Math.trunc(Number(limit) || 0));
  if (!Number.isFinite(ceiling) || ceiling <= 0 || boundedLimit === 0) return [];
  return [...(Array.isArray(games) ? games : [])]
    .filter(game => Number.isFinite(game?.released_at) && game.released_at > 0 && game.released_at <= ceiling)
    .sort((left, right) => right.released_at - left.released_at
      || (right.heat || 0) - (left.heat || 0)
      || left.id - right.id)
    .slice(0, boundedLimit);
}

export function nonHotNewIds(appearances, platform = 'all') {
  const excluded = new Set(appearances.filter(row => row.chart === 'hot' || row.chart === 'new').map(row => row.game_id));
  return new Set(appearances
    .filter(row => row.chart !== 'hot' && row.chart !== 'new' && (platform === 'all' || row.platform === platform))
    .map(row => row.game_id)
    .filter(id => !excluded.has(id)));
}

export function buildBoards({ games, metrics, appearances }, { platform = 'all', baselineMetrics = null, globalAppearances = appearances, eligibleIds = null } = {}) {
  const metricMap = new Map(metrics.map(metric => [metric.game_id, metric]));
  const heatMedian = baselineMetrics?.heatMedian ?? median(games.map(game => game.heat));
  const scoreMedian = baselineMetrics?.scoreMedian ?? median(games.map(game => game.score));
  const dailyMedian = baselineMetrics?.dailyMedian ?? median(metrics.map(metric => metric.heat_per_day_lifetime));
  const byHeat = list => [...list].sort((a, b) => (b.heat || 0) - (a.heat || 0));
  const idsForChart = chart => new Set(appearances.filter(row => row.chart === chart).map(row => row.game_id));
  const nonHot = nonHotNewIds(globalAppearances, platform);
  const eligible = eligibleIds ? new Set(eligibleIds) : null;
  const androidIds = new Set(appearances.filter(row => row.platform === 'android').map(row => row.game_id));
  const iosIds = new Set(appearances.filter(row => row.platform === 'ios').map(row => row.game_id));
  const observedAt = Math.max(...games.map(game => game.observed_at || 0), 0);
  const potential = games.filter(game => {
    const metric = metricMap.get(game.id);
    return metric && game.score > scoreMedian && game.heat < heatMedian && metric.heat_per_day_lifetime > dailyMedian && metric.age_hours > 0 && metric.age_hours <= 360;
  });
  const realized = games.filter(game => {
    const metric = metricMap.get(game.id);
    return metric && game.score > scoreMedian && game.heat > heatMedian && metric.heat_per_day_lifetime > dailyMedian && metric.age_hours > 0 && metric.age_hours <= 720;
  });
  const scoreValues = games.map(game => game.score);
  const heatValues = games.map(game => game.heat);
  const dailyHeat = games.filter(game => metricMap.get(game.id)?.heat_per_day_lifetime !== null && metricMap.get(game.id)?.heat_per_day_lifetime !== undefined)
    .sort((a, b) => metricMap.get(b.id).heat_per_day_lifetime - metricMap.get(a.id).heat_per_day_lifetime);
  const hasHistory = potential.some(game => metricMap.get(game.id)?.history_available && metricMap.get(game.id)?.growth_per_hour_24h !== null);
  const scoreValuesPotential = potential.map(game => game.score);
  const dailyValuesPotential = potential.map(game => metricMap.get(game.id)?.heat_per_day_lifetime);
  const growthValuesPotential = potential.map(game => metricMap.get(game.id)?.growth_per_hour_24h);
  const potentialRanked = potential.map(game => {
    const metric = metricMap.get(game.id);
    const scoreRank = percentileRank(scoreValuesPotential, game.score) || 0;
    const dailyRank = percentileRank(dailyValuesPotential, metric?.heat_per_day_lifetime) || 0;
    const growthRank = percentileRank(growthValuesPotential, metric?.growth_per_hour_24h) || 0;
    const potentialScore = hasHistory ? (0.35 * scoreRank + 0.40 * dailyRank + 0.25 * growthRank) * 100 : (0.45 * scoreRank + 0.55 * dailyRank) * 100;
    return { ...game, potentialScore: Math.round(potentialScore * 10) / 10, potentialFormula: hasHistory ? '评分35% · 日均40% · 近24h增长25%' : '历史不可用：评分45% · 日均55%' };
  }).sort((a,b)=>b.potentialScore-a.potentialScore||(b.heat||0)-(a.heat||0));
  return {
    recentRelease: byHeat(games.filter(game => game.released_at && observedAt - game.released_at >= 0 && observedAt - game.released_at <= 14 * 86400)).slice(0, 15),
    potential: potentialRanked.slice(0, 15),
    realized: byHeat(realized).slice(0, 15),
    dailyHeat: dailyHeat.slice(0, 15),
    hot: byHeat(games.filter(game => idsForChart('hot').has(game.id))).slice(0, 15),
    newGames: byHeat(games.filter(game => idsForChart('new').has(game.id))).slice(0, 15),
    nonHotNew: byHeat(games.filter(game => nonHot.has(game.id) && (!eligible || eligible.has(game.id)))).slice(0, 15),
    rating: [...games].filter(game => game.score !== null).sort((a, b) => b.score - a.score || (b.heat || 0) - (a.heat || 0)).slice(0, 15),
    reputationWarning: [...games].filter(game => game.score !== null && game.heat >= heatMedian).sort((a, b) => a.score - b.score).slice(0, 15),
    iosExclusive: byHeat(games.filter(game => iosIds.has(game.id) && !androidIds.has(game.id))).slice(0, 15),
    androidExclusive: byHeat(games.filter(game => androidIds.has(game.id) && !iosIds.has(game.id))).slice(0, 15),
    trafficOutperformance: [...games].filter(game => game.score !== null).map(game => ({ ...game, divergence: percentileRank(heatValues, game.heat) - percentileRank(scoreValues, game.score) })).sort((a, b) => b.divergence - a.divergence).slice(0, 15),
    reputationOutperformance: [...games].filter(game => game.score !== null).map(game => ({ ...game, divergence: percentileRank(scoreValues, game.score) - percentileRank(heatValues, game.heat) })).sort((a, b) => b.divergence - a.divergence).slice(0, 15),
  };
}
