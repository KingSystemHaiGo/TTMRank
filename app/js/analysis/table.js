import { age, chartName, compactNumber, dateTime, decimal, platformName } from '../core/format.js';
import { createGameIcon } from '../core/game-icon.js';
import { clear, element } from '../core/safe-dom.js';

const BOARD_DEFS = [
  ['recentRelease','近两周上新 TOP15','发布 14 天内，按当前热度降序',''],
  ['potential','潜力股','高口碑、低累计热度、高日均热度、上线 ≤15 天','violet'],
  ['realized','潜力兑现','口碑、总热度和日均热度均超过中位数',''],
  ['dailyHeat','日均热度 TOP15','当前热度 ÷ 精确上线小时 × 24','orange'],
  ['hot','热门榜 TOP15','已采集热门榜中的游戏，按热度排序',''],
  ['newGames','新品榜 TOP15','已采集新品榜中的游戏，按热度排序','blue'],
  ['nonHotNew','非新非热榜 TOP15','未进入 Android 或 iOS 的任何热门榜、新品榜，但进入至少一个其他榜单',''],
  ['trafficOutperformance','流量超额 TOP15','热度百分位高于评分百分位','orange'],
  ['reputationOutperformance','口碑超额 TOP15','评分百分位高于热度百分位','blue'],
  ['rating','评分 TOP15','有效评分降序，同时展示热度',''],
  ['reputationWarning','口碑预警榜','热度高于中位数，按评分升序','red'],
  ['iosExclusive','iOS 独占发现','仅出现在已采集 iOS 榜单的游戏','violet'],
  ['androidExclusive','Android 独占发现','仅出现在已采集 Android 榜单的游戏','blue'],
];

export function renderMetrics(container, metrics) {
  clear(container);
  const cards = [
    ['收录',metrics.count,'游戏 ID 去重','primary'],['日均热度中位数',compactNumber(metrics.dailyMedian),`P25 ${compactNumber(metrics.dailyP25)} · P75 ${compactNumber(metrics.dailyP75)}`,'primary'],['评分中位数',decimal(metrics.scoreMedian),`${metrics.scoreSamples} 个有效样本`,'primary'],['高分',metrics.highScoreCount,`评分达到当前阈值`,'primary'],
    ['均分',decimal(metrics.scoreMean),`${metrics.scoreSamples} 个有效样本`,'supporting'],['均热',compactNumber(metrics.heatMean),`P90 ${compactNumber(metrics.heatP90)}`,'supporting'],['日均热',compactNumber(metrics.dailyMean),`P90 ${compactNumber(metrics.dailyP90)}`,'supporting'],['热度中位数',compactNumber(metrics.heatMedian),`P25 ${compactNumber(metrics.heatP25)} · P75 ${compactNumber(metrics.heatP75)}`,'supporting'],
  ];
  cards.forEach(([label,value,note,priority]) => container.append(element('article',{className:`metric-card metric-${priority}`,attrs:{'data-priority':priority},children:[element('div',{className:'metric-label',text:label}),element('div',{className:'metric-value num',text:value}),element('div',{className:'metric-note',text:note})]})));
}

export function renderLatestReleases(container, games, context, openDetail) {
  clear(container);
  const metricMap = new Map(context.metrics.map(metric => [metric.game_id, metric]));
  if (!games.length) {
    container.append(element('div', { className: 'latest-release-empty', text: '当前筛选下暂无有效发布时间的游戏' }));
    return;
  }
  games.forEach((game, index) => {
    const metric = metricMap.get(game.id);
    const tags = (game.tags || []).filter(tag => tag !== 'TapTap制造').slice(0, 2).join(' / ') || '暂无类型标签';
    const released = dateTime(game.released_at);
    const button = element('button', {
      className: 'latest-release-item',
      attrs: {
        type: 'button',
        'data-released-at': game.released_at,
        'aria-label': `${index + 1} ${game.title}，发布于${released}，打开游戏信息`,
      },
      children: [
        element('span', { className: 'latest-release-rank num', text: String(index + 1).padStart(2, '0') }),
        createGameIcon(game, { size: 42, proxyEndpoint: window.TTMRANK_ICON_PROXY || '' }),
        element('span', { className: 'latest-release-main', children: [
          element('strong', { className: 'latest-release-title', text: game.title }),
          element('small', { text: tags }),
        ] }),
        element('span', { className: 'latest-release-time', children: [
          element('strong', { text: released }),
          element('small', { text: age(metric?.age_hours) }),
        ] }),
      ],
    });
    button.addEventListener('click', () => openDetail(game.id, button));
    container.append(button);
  });
}

function gameValue(key, game, metric) {
  if (key === 'potential') return [decimal(game.potentialScore),'潜力指数'];
  if (key === 'dailyHeat') return [compactNumber(metric?.heat_per_day_lifetime),'日均热度'];
  if (key === 'rating' || key === 'reputationWarning') return [decimal(game.score),'评分'];
  if (key.includes('Outperformance')) return [`${Math.round((game.divergence||0)*100)}%`,'背离百分位'];
  return [compactNumber(game.heat),'热度'];
}

export function renderBoards(container, boards, context, openDetail) {
  clear(container); const metricMap = new Map(context.metrics.map(item=>[item.game_id,item]));
  BOARD_DEFS.forEach(([key,title,description,tone]) => {
    const list = boards[key] || []; const board = element('article',{className:'board',attrs:{'data-tone':tone}});
    board.append(element('div',{className:'board-head',children:[element('div',{children:[element('h3',{text:title}),element('p',{text:description})]}),element('span',{className:'tag',text:`${list.length} 款`})]}));
    if (!list.length) board.append(element('div',{className:'empty',text:'当前筛选下暂无符合条件的游戏'}));
    list.forEach((game,index)=>{
      const metric=metricMap.get(game.id); const [value,label]=gameValue(key,game,metric);
      const row=element('button',{className:'game-row',attrs:{type:'button','aria-label':`${index+1} ${game.title}，打开游戏信息`},children:[element('div',{className:`rank ${index<3?'top':''}`,text:index+1}),createGameIcon(game,{proxyEndpoint:window.TTMRANK_ICON_PROXY||''}),element('div',{className:'game-main',children:[element('div',{className:'game-title',text:game.title}),element('div',{className:'game-meta',text:`${dateTime(game.released_at)} · ${age(metric?.age_hours)} · ${(game.tags||[]).filter(tag=>tag!=='TapTap制造').slice(0,2).join(' / ')||'暂无类型标签'}`})]}),element('div',{className:'game-value',children:[document.createTextNode(value),element('small',{text:label})]})]});
      row.addEventListener('click',()=>openDetail(game.id,row)); board.append(row);
    }); container.append(board);
  });
}

export function renderTypeList(container, types) {
  clear(container); const max=Math.max(...types.map(item=>item.count),1);
  types.forEach(item=>container.append(element('div',{className:'type-row',children:[element('strong',{text:item.tag}),element('div',{className:'type-bar',children:[element('i',{attrs:{style:`width:${item.count/max*100}%`}})]}),element('span',{className:'muted num',text:`${item.count} 款 · 中位 ${compactNumber(item.heatMedian)}`})]})));
}

export function historyMetricText(metric, field) {
  const value = metric?.[field];
  if (value === null || value === undefined) return '历史积累中';
  const prefix = field === 'heat_delta_1h' && metric?.heat_delta_1h_estimated ? '≈' : '';
  return `${prefix}${compactNumber(value)}`;
}

export function renderDrawer(content, game, metric, appearances) {
  clear(content); content.append(element('div',{className:'detail-head',children:[createGameIcon(game,{size:76,proxyEndpoint:window.TTMRANK_ICON_PROXY||''}),element('div',{children:[element('h2',{text:game.title}),element('div',{className:'muted',text:(game.tags||[]).filter(tag=>tag!=='TapTap制造').slice(0,4).join(' · ')||'暂无类型标签'})]})]}));
  const hourEstimated=metric?.heat_delta_1h_estimated===true;
  const hourTitle=hourEstimated&&metric?.heat_delta_1h_basis_hours
    ? `按最近 ${decimal(metric.heat_delta_1h_basis_hours)} 小时的实际观测变化折算为每小时`
    : '';
  const stats=[['当前热度',compactNumber(game.heat)],['日均热度',compactNumber(metric?.heat_per_day_lifetime)],['评分',decimal(game.score)],['上线时长',age(metric?.age_hours)],[hourEstimated?'近 1 小时增长（估算）':'近 1 小时增长',historyMetricText(metric,'heat_delta_1h'),hourTitle],['近 24 小时增长',historyMetricText(metric,'heat_delta_24h')],['近 7 天增长',historyMetricText(metric,'heat_delta_7d')],['近 24h 每小时',historyMetricText(metric,'growth_per_hour_24h')],['榜单覆盖',metric?.chart_coverage||appearances.length],['平台覆盖',metric?.platform_coverage||new Set(appearances.map(row=>row.platform)).size],['开发 / 发行',game.developer||'未知']];
  content.append(element('div',{className:'detail-grid',children:stats.map(([label,value,title])=>element('div',{className:'detail-stat',attrs:title?{title}:{},children:[element('span',{text:label}),element('strong',{text:value})]}))}));
  content.append(element('div',{className:'appearance-list',children:[element('h3',{text:'跨榜单表现'}),...appearances.sort((a,b)=>a.rank-b.rank).map(row=>element('div',{className:'appearance-item',children:[element('span',{text:`${platformName(row.platform)} · ${chartName(row.chart)}`}),element('strong',{text:`#${row.rank}`})]}))]}));
  if(game.url) content.append(element('a',{className:'btn btn-primary',text:'打开 TapTap 游戏页',attrs:{href:game.url,target:'_blank',rel:'noopener noreferrer'}}));
}
