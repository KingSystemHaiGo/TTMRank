import { median, percentileRank } from '../core/statistics.js';

export const TRACKS = Object.freeze([
  { id: 'casual', name: '轻休闲 / 益智', keywords: ['休闲','益智','解谜','消除','物理','点击','合成'] },
  { id: 'idle', name: '模拟 / 放置', keywords: ['模拟','经营','放置','挂机','养成','种田'] },
  { id: 'narrative', name: '文字 / 叙事', keywords: ['文字','剧情','叙事','视觉小说','互动小说','恋爱'] },
  { id: 'horror', name: '解谜 / 恐怖', keywords: ['恐怖','悬疑','惊悚','密室','推理'] },
  { id: 'survivor', name: 'Roguelike / 幸存者', keywords: ['Roguelike','肉鸽','割草','幸存者','随机'] },
  { id: 'cards', name: '卡牌 / 构筑', keywords: ['卡牌','DBG','构筑','桌面和棋类'] },
  { id: 'defense', name: '塔防 / 策略', keywords: ['塔防','策略','战棋','即时战略','回合制'] },
  { id: 'platform', name: '动作 / 平台 / 格斗', keywords: ['动作','平台跳跃','格斗','横版','跑酷'] },
  { id: 'shooter', name: '射击', keywords: ['射击','FPS','TPS','弹幕','飞行射击'] },
  { id: 'rpg', name: 'RPG / 成长', keywords: ['RPG','角色扮演','冒险','刷宝'] },
  { id: 'rhythm', name: '音乐 / 节奏', keywords: ['音乐','音游','节奏','下落式'] },
  { id: 'sandbox', name: '沙盒 / 建造', keywords: ['沙盒','建造','开放世界','生存','创造'] },
]);

const finite = values => values.filter(value => Number.isFinite(value));
const percent = (values, value) => percentileRank(finite(values), value) || 0;

function sampleConfidence(sampleSize) {
  if (sampleSize < 3) return { level: 'low', sampleSize, label: `样本较少（N=${sampleSize}）` };
  if (sampleSize < 8) return { level: 'medium', sampleSize, label: `样本有限（N=${sampleSize}）` };
  return { level: 'high', sampleSize, label: `样本较充分（N=${sampleSize}）` };
}

export function analyzeGameSignals(data) {
  const metricMap = new Map(data.metrics.map(metric => [metric.game_id, metric]));
  const games = data.games.filter(game => game.is_taptap_made);
  const tracks = TRACKS.map(track => {
    const matched = games.filter(game => (game.tags || []).some(tag => track.keywords.includes(tag)));
    const daily = finite(matched.map(game => metricMap.get(game.id)?.heat_per_day_lifetime));
    const growth = finite(matched.map(game => metricMap.get(game.id)?.growth_per_hour_24h));
    const scores = finite(matched.map(game => game.score));
    const heat = finite(matched.map(game => game.heat));
    const chartCoverage = finite(matched.map(game => metricMap.get(game.id)?.chart_coverage));
    return {
      ...track,
      count: matched.length,
      dailyMedian: median(daily) || 0,
      growthMedian: median(growth) || 0,
      scoreMedian: median(scores) || 0,
      heatMedian: median(heat) || 0,
      coverageMedian: median(chartCoverage) || 0,
      confidence: sampleConfidence(matched.length),
      representatives: [...matched].sort((a, b) => {
        const dailyDifference = (metricMap.get(b.id)?.heat_per_day_lifetime || 0) - (metricMap.get(a.id)?.heat_per_day_lifetime || 0);
        return dailyDifference || (b.heat || 0) - (a.heat || 0);
      }).slice(0, 2).map(game => ({ id: game.id, title: game.title })),
    };
  }).filter(track => track.count > 0);

  const populations = {
    daily: tracks.map(track => track.dailyMedian),
    scores: tracks.map(track => track.scoreMedian),
    growth: tracks.map(track => track.growthMedian),
    coverage: tracks.map(track => track.coverageMedian),
  };
  return tracks.map(track => ({
    ...track,
    signalScore: Math.round(100 * (
      .35 * percent(populations.daily, track.dailyMedian)
      + .3 * percent(populations.scores, track.scoreMedian)
      + .2 * percent(populations.growth, track.growthMedian)
      + .15 * percent(populations.coverage, track.coverageMedian)
    )),
  })).sort((a, b) => b.signalScore - a.signalScore || b.dailyMedian - a.dailyMedian);
}
