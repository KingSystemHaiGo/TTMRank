import { median, percentileRank } from '../core/statistics.js';

export const PROFILES = Object.freeze([
  { id: 'solo-validate', name: '单人快速验证', pace: '2–8 周原型', fit: { casual: 1, narrative: .9, idle: .85, horror: .75, survivor: .55 } },
  { id: 'solo-project', name: '单人完整项目', pace: '6–18 月', fit: { casual: .8, narrative: .85, idle: .8, horror: .75, survivor: .75, cards: .65, platform: .6 } },
  { id: 'technical-solo', name: '技术型单人', pace: '系统先行', fit: { survivor: .9, cards: .85, defense: .8, shooter: .7, sandbox: .7, idle: .75 } },
  { id: 'art-solo', name: '美术 / 内容型单人', pace: '表达先行', fit: { narrative: 1, horror: .9, casual: .8, rhythm: .75, platform: .65 } },
  { id: 'small-team', name: '2–3 人小队', pace: '分工协作', fit: { casual: .8, narrative: .85, idle: .85, horror: .85, survivor: .9, cards: .85, defense: .9, platform: .8, shooter: .65, rpg: .65, rhythm: .75, sandbox: .6 } },
]);

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
const isMarketReference = game => game.vendor_verification === 'verified' && ['major', 'professional'].includes(game.vendor_scale);
const isPersonalEvidence = game => game.vendor_verification === 'verified' && ['solo', 'small_team'].includes(game.vendor_scale);

function sampleConfidence(sampleSize, subject) {
  if (sampleSize === 0) return { level: 'none', sampleSize, label: `${subject}不足（N=0）` };
  if (sampleSize < 3) return { level: 'low', sampleSize, label: `${subject}低置信（N=${sampleSize}）` };
  if (sampleSize < 8) return { level: 'medium', sampleSize, label: `${subject}中等置信（N=${sampleSize}）` };
  return { level: 'high', sampleSize, label: `${subject}较高置信（N=${sampleSize}）` };
}

function opportunityScore(track, populations, fields) {
  const dailyRank = percent(populations.daily, track[fields.daily]);
  const scoreRank = percent(populations.scores, track[fields.score]);
  const growthRank = percent(populations.growth, track[fields.growth]);
  const sampleScarcity = 1 - percent(populations.counts, track[fields.count]);
  return {
    score: Math.round(100 * (.35 * dailyRank + .25 * scoreRank + .25 * growthRank + .15 * sampleScarcity)),
    sampleScarcityScore: Math.round(100 * sampleScarcity),
  };
}

export function analyzeMakerOpportunities(data, profileId = PROFILES[0].id) {
  const profile = PROFILES.find(item => item.id === profileId) || PROFILES[0];
  const metricMap = new Map(data.metrics.map(metric => [metric.game_id, metric]));
  const makerGames = data.games.filter(game => game.is_taptap_made);
  const tracks = TRACKS.map(track => {
    const games = makerGames.filter(game => (game.tags || []).some(tag => track.keywords.includes(tag)));
    const referenceGames = games.filter(isMarketReference);
    const personalEvidenceGames = games.filter(isPersonalEvidence);
    const unknownGames = games.filter(game => !isMarketReference(game) && !isPersonalEvidence(game));
    const daily = finite(games.map(game => metricMap.get(game.id)?.heat_per_day_lifetime));
    const growth = finite(games.map(game => metricMap.get(game.id)?.growth_per_hour_24h));
    const scores = finite(games.map(game => game.score));
    const personalDaily = finite(personalEvidenceGames.map(game => metricMap.get(game.id)?.heat_per_day_lifetime));
    const personalGrowth = finite(personalEvidenceGames.map(game => metricMap.get(game.id)?.growth_per_hour_24h));
    const personalScores = finite(personalEvidenceGames.map(game => game.score));
    return {
      ...track,
      games,
      count: games.length,
      dailyMedian: median(daily) || 0,
      growthMedian: median(growth) || 0,
      scoreMedian: median(scores) || 0,
      referenceCount: referenceGames.length,
      personalEvidenceCount: personalEvidenceGames.length,
      unknownCount: unknownGames.length,
      professional: referenceGames.length,
      unverified: unknownGames.length,
      personalDailyMedian: median(personalDaily) || 0,
      personalGrowthMedian: median(personalGrowth) || 0,
      personalScoreMedian: median(personalScores) || 0,
      marketConfidence: sampleConfidence(games.length, '市场样本'),
      decisionConfidence: sampleConfidence(personalEvidenceGames.length, '个人 / 小队证据'),
    };
  }).filter(track => track.count > 0);

  const marketPopulations = {
    daily: tracks.map(track => track.dailyMedian),
    growth: tracks.map(track => track.growthMedian),
    scores: tracks.map(track => track.scoreMedian),
    counts: tracks.map(track => track.count),
  };
  const evidenceTracks = tracks.filter(track => track.personalEvidenceCount > 0);
  const evidencePopulations = {
    daily: evidenceTracks.map(track => track.personalDailyMedian),
    growth: evidenceTracks.map(track => track.personalGrowthMedian),
    scores: evidenceTracks.map(track => track.personalScoreMedian),
    counts: evidenceTracks.map(track => track.personalEvidenceCount),
  };
  return tracks.map(track => {
    const market = opportunityScore(track, marketPopulations, {
      daily: 'dailyMedian', score: 'scoreMedian', growth: 'growthMedian', count: 'count',
    });
    const profileFit = profile.fit[track.id] || .35;
    const evidence = track.personalEvidenceCount > 0
      ? opportunityScore(track, evidencePopulations, {
        daily: 'personalDailyMedian', score: 'personalScoreMedian', growth: 'personalGrowthMedian', count: 'personalEvidenceCount',
      })
      : null;
    const evidenceWeight = evidence ? Math.min(.4, .4 * track.personalEvidenceCount / 5) : 0;
    const personalScore = Math.round((1 - evidenceWeight) * profileFit * 100 + evidenceWeight * (evidence?.score ?? 0));
    return {
      ...track,
      marketScore: market.score,
      sampleScarcityScore: market.sampleScarcityScore,
      personalEvidenceScore: evidence?.score ?? null,
      personalEvidenceWeight: evidenceWeight,
      personalScore,
      personalScoreBasis: evidence ? 'profile_and_verified_evidence' : 'profile_only',
      profile,
    };
  }).sort((a, b) => b.personalScore - a.personalScore || b.marketScore - a.marketScore);
}
