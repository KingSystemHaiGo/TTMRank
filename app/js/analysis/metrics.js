import { mean, median, quantile, safeRatio } from '../core/statistics.js';

export function coreMetrics(data, highScore = 8.5) {
  const heats = data.games.map(game => game.heat).filter(value => value !== null);
  const scores = data.games.map(game => game.score).filter(value => value !== null);
  const daily = data.metrics.map(metric => metric.heat_per_day_lifetime).filter(value => value !== null);
  const top = [...heats].sort((a,b) => b-a).slice(0,10);
  return {
    count: data.games.length,
    scoreMean: mean(scores), heatMean: mean(heats), dailyMean: mean(daily),
    dailyMedian: median(daily), heatMedian: median(heats), scoreMedian: median(scores),
    highScoreCount: scores.filter(score => score >= highScore).length,
    heatP25: quantile(heats,.25), heatP75: quantile(heats,.75), heatP90: quantile(heats,.9),
    dailyP25: quantile(daily,.25), dailyP75: quantile(daily,.75), dailyP90: quantile(daily,.9),
    top10Share: safeRatio(top.reduce((sum,value)=>sum+value,0), heats.reduce((sum,value)=>sum+value,0)),
    heatSamples: heats.length, scoreSamples: scores.length, dailySamples: daily.length,
  };
}

export function typeSummary(data) {
  const buckets = new Map();
  data.games.forEach(game => (game.tags || []).filter(tag => tag !== 'TapTap制造').forEach(tag => {
    if (!buckets.has(tag)) buckets.set(tag, []);
    buckets.get(tag).push(game);
  }));
  return [...buckets.entries()].map(([tag,games]) => ({ tag, count:games.length, heatMedian:median(games.map(game=>game.heat)), heatMean:mean(games.map(game=>game.heat)), representative:[...games].sort((a,b)=>(b.heat||0)-(a.heat||0))[0] })).sort((a,b)=>b.count-a.count).slice(0,15);
}
