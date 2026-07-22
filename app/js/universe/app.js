import { compactNumber, dateTime, decimal } from '../core/format.js';
import { createGameIcon } from '../core/game-icon.js';
import { clear, element } from '../core/safe-dom.js';
import { loadUniverse } from './data-client.js?v=2';
import { buildUniverseLayout, renderMode, selectMapNodes } from './model.js?v=2';

const canvas = document.getElementById('universeCanvas');
const plot = document.getElementById('universePlot');
const stage = document.getElementById('universeStage');
const status = document.getElementById('universeStatus');
const freshness = document.getElementById('universeFreshness');
const list = document.getElementById('universeList');
const count = document.getElementById('universeCount');
const queryInput = document.getElementById('universeQuery');
const clusterSelect = document.getElementById('universeCluster');
const clearFilters = document.getElementById('universeClear');
const modeLink = document.getElementById('universeModeLink');
const detail = document.getElementById('universeDetail');
const emptyDetail = document.getElementById('universeDetailEmpty');

const params = new URLSearchParams(window.location.search);
let state = {
  query: String(params.get('query') || '').trim().slice(0, 80),
  cluster: String(params.get('cluster') || '').trim().slice(0, 40),
  game: Number(params.get('game')) || 0,
  requestedMode: params.get('render') === 'static' ? 'static' : 'auto',
};
let layout = null;
let renderer = null;
let webglContext = null;
let selectedId = 0;

const COLORS = ['#0aaea8', '#6f7ee8', '#e5a33d', '#dc7186', '#6eaa61', '#9b78d1', '#4f9fd0', '#da8c5b', '#829398'];

function syncUrl({ push = false } = {}) {
  const next = new URLSearchParams();
  if (state.query) next.set('query', state.query);
  if (state.cluster) next.set('cluster', state.cluster);
  if (state.game) next.set('game', String(state.game));
  if (state.requestedMode === 'static') next.set('render', 'static');
  const url = `${window.location.pathname}${next.size ? `?${next}` : ''}`;
  history[push ? 'pushState' : 'replaceState']({}, '', url);
}

function webglCapability() {
  try {
    return canvas.getContext('webgl2', { alpha: true, antialias: false, powerPreference: 'low-power' })
      || canvas.getContext('webgl', { alpha: true, antialias: false, powerPreference: 'low-power' });
  } catch {
    return null;
  }
}

function constrainedBeforeWebgl() {
  return state.requestedMode === 'static'
    || Boolean(navigator.connection?.saveData)
    || Number(navigator.hardwareConcurrency || 4) <= 2;
}

function clusterColor(cluster) {
  const index = Math.max(0, layout.clusters.indexOf(cluster));
  return COLORS[index % COLORS.length];
}

function filteredNodes() {
  const query = state.query.toLocaleLowerCase('zh-CN');
  return layout.nodes.filter(node => {
    if (state.cluster && node.cluster !== state.cluster) return false;
    if (!query) return true;
    return [node.title, node.cluster, ...node.tags].join(' ').toLocaleLowerCase('zh-CN').includes(query);
  });
}

function displayedMapNodes(nodes = filteredNodes()) {
  return selectMapNodes(nodes, {
    focused: Boolean(state.query || state.cluster),
    maxPerLane: innerWidth <= 720 ? 3 : 5,
    maxFocused: innerWidth <= 720 ? 6 : 12,
    includeId: selectedId,
  });
}

function visibleClusters(nodes = filteredNodes()) {
  const used = new Set(nodes.map(node => node.cluster));
  return layout.clusters.filter(cluster => used.has(cluster));
}

function markerY(node, clusters) {
  const lane = Math.max(0, clusters.indexOf(node.cluster));
  return (lane + (node.laneSlot === 0 ? 0.28 : 0.72)) / Math.max(1, clusters.length);
}

function resizeStageFor(clusters) {
  const maximum = innerWidth <= 720 ? 660 : 720;
  stage.style.height = `${Math.min(maximum, Math.max(230, clusters.length * 80 + 80))}px`;
}

function mapStatus() {
  const nodes = filteredNodes();
  const displayed = displayedMapNodes(nodes);
  return displayed.length < nodes.length
    ? `地图展示${displayed.length}个代表游戏，索引保留${nodes.length}款`
    : `地图展示${nodes.length}款游戏`;
}

function markerLabel(node) {
  return `${node.title}，${node.cluster}，热度${compactNumber(node.heat)}，评分${decimal(node.score)}，覆盖${node.chart_coverage}个榜单`;
}

function renderPlot(nodes, totals = filteredNodes()) {
  clear(plot);
  const clusters = visibleClusters(totals);
  resizeStageFor(clusters);
  clusters.forEach((cluster, index) => {
    const top = ((index + 0.5) / clusters.length) * 100;
    const clusterCount = totals.filter(node => node.cluster === cluster).length;
    plot.append(
      element('button', {
        className: `universe-lane-label${state.cluster === cluster ? ' is-selected' : ''}`,
        text: `${cluster} ${clusterCount}`,
        attrs: { type: 'button', style: `top:${top}%`, 'data-cluster': cluster, 'aria-pressed': String(state.cluster === cluster), 'aria-label': `${cluster}类型，共${clusterCount}款` },
      }),
      element('i', { className: 'universe-lane-line', attrs: { style: `top:${top}%` } }),
    );
  });
  plot.querySelectorAll('.universe-lane-label').forEach(button => button.addEventListener('click', () => {
    state.cluster = state.cluster === button.dataset.cluster ? '' : button.dataset.cluster;
    clearSelection();
    clusterSelect.value = state.cluster;
    applyFilters();
  }));
  const layer = element('div', { className: 'universe-data-layer' });
  nodes.forEach(node => {
    const marker = element('button', {
      className: `universe-marker${node.id === selectedId ? ' is-selected' : ''}`,
      attrs: {
        type: 'button',
        'data-game-id': node.id,
        'aria-label': markerLabel(node),
        'aria-pressed': String(node.id === selectedId),
        style: `--cluster:${clusterColor(node.cluster)};left:${node.displayX * 100}%;top:${markerY(node, clusters) * 100}%`,
      },
    });
    marker.append(
      createGameIcon({ title: node.title, icon_source_url: node.icon || '' }, { size: 38 }),
      element('span', { className: 'universe-marker-score', text: decimal(node.score), attrs: { 'data-band': node.scoreBand, 'aria-hidden': 'true' } }),
      element('span', { className: 'universe-marker-cover', text: node.chart_coverage, attrs: { 'aria-hidden': 'true' } }),
    );
    marker.addEventListener('click', () => selectGame(node.id, { push: true }));
    layer.append(marker);
  });
  plot.append(layer);
}

function detailFact(label, value) {
  const item = element('div', { className: 'universe-fact' });
  item.append(element('dt', { text: label }), element('dd', { text: value }));
  return item;
}

function showDetail(node) {
  emptyDetail.hidden = true;
  detail.hidden = false;
  clear(detail);
  const header = element('div', { className: 'universe-detail-head' });
  header.append(createGameIcon({ title: node.title, icon_source_url: node.icon || '' }, { size: 54 }));
  const title = element('div');
  title.append(element('h2', { text: node.title }), element('p', { text: [node.cluster, ...node.tags.filter(tag => tag !== node.cluster)].slice(0, 3).join(' · ') }));
  header.append(title);
  const facts = element('dl', { className: 'universe-facts' });
  facts.append(
    detailFact('当前热度', compactNumber(node.heat)),
    detailFact('评分', decimal(node.score)),
    detailFact('日均热度', compactNumber(node.daily_heat)),
    detailFact('近24小时', node.growth_24h === null || node.growth_24h === undefined ? '历史积累中' : `${Number(node.growth_24h) >= 0 ? '+' : ''}${compactNumber(node.growth_24h)}`),
    detailFact('榜单覆盖', `${node.chart_coverage}个榜单`),
    detailFact('平台覆盖', `${node.platform_coverage}个平台`),
  );
  const actions = element('div', { className: 'universe-detail-actions' });
  if (node.url) actions.append(element('a', { text: '打开 TapTap 游戏页', attrs: { href: node.url, target: '_blank', rel: 'noreferrer' } }));
  actions.append(element('a', { text: '在游戏分析中查看', attrs: { href: `analysis.html?scope=made&query=${encodeURIComponent(node.title)}` } }));
  detail.append(header, facts, actions);
}

function clearSelection() {
  selectedId = 0;
  state.game = 0;
  detail.hidden = true;
  emptyDetail.hidden = false;
}

function selectGame(id, { push = false } = {}) {
  const index = layout.nodes.findIndex(node => node.id === Number(id));
  if (index < 0) return;
  selectedId = layout.nodes[index].id;
  state.game = selectedId;
  syncUrl({ push });
  showDetail(layout.nodes[index]);
  const nodes = filteredNodes();
  renderList(nodes);
  renderPlot(displayedMapNodes(nodes), nodes);
}

function renderList(nodes) {
  clear(list);
  count.textContent = `${nodes.length}款`;
  if (!nodes.length) {
    list.append(element('p', { className: 'universe-list-empty', text: '没有符合当前条件的游戏。' }));
    return;
  }
  nodes.forEach(node => {
    const button = element('button', {
      className: `universe-game-row${node.id === selectedId ? ' is-selected' : ''}`,
      attrs: { type: 'button', 'data-game-id': node.id, 'aria-pressed': String(node.id === selectedId) },
    });
    const marker = element('i', { attrs: { style: `--cluster:${clusterColor(node.cluster)}` } });
    const copy = element('span', { className: 'universe-game-copy' });
    copy.append(element('strong', { text: node.title }), element('small', { text: `${node.cluster} · 评分${decimal(node.score)} · 热度${compactNumber(node.heat)}` }));
    button.append(marker, copy);
    button.addEventListener('click', () => selectGame(node.id, { push: true }));
    list.append(button);
  });
}

function applyFilters() {
  const nodes = filteredNodes();
  if (selectedId && !nodes.some(node => node.id === selectedId)) clearSelection();
  clearFilters.hidden = !state.query && !state.cluster;
  renderList(nodes);
  renderPlot(displayedMapNodes(nodes), nodes);
  renderer?.setVisibleIds(nodes.map(node => node.id), visibleClusters(nodes));
  if (stage.dataset.renderMode !== 'loading') status.textContent = mapStatus();
  syncUrl();
}

function setupFilters() {
  queryInput.value = state.query;
  clear(clusterSelect);
  clusterSelect.append(element('option', { text: '全部类型', attrs: { value: '' } }));
  layout.clusters.forEach(cluster => clusterSelect.append(element('option', { text: cluster, attrs: { value: cluster } })));
  if (layout.clusters.includes(state.cluster)) clusterSelect.value = state.cluster;
  else state.cluster = '';
  queryInput.addEventListener('input', () => { state.query = queryInput.value.trim(); clearSelection(); applyFilters(); });
  clusterSelect.addEventListener('change', () => { state.cluster = clusterSelect.value; clearSelection(); applyFilters(); });
  clearFilters.addEventListener('click', () => {
    state.query = '';
    state.cluster = '';
    clearSelection();
    queryInput.value = '';
    clusterSelect.value = '';
    applyFilters();
    queryInput.focus();
  });
}

async function enableWebgl() {
  webglContext = constrainedBeforeWebgl() ? null : webglCapability();
  const mode = renderMode({
    requested: state.requestedMode,
    webgl: Boolean(webglContext),
    saveData: Boolean(navigator.connection?.saveData),
    hardwareConcurrency: navigator.hardwareConcurrency || 4,
  });
  if (mode !== 'webgl') {
    canvas.hidden = true;
    modeLink.hidden = state.requestedMode !== 'static';
    modeLink.textContent = '启用增强地图';
    const dynamicParams = new URLSearchParams(window.location.search);
    dynamicParams.delete('render');
    modeLink.href = `universe.html${dynamicParams.size ? `?${dynamicParams}` : ''}`;
    stage.dataset.renderMode = 'static';
    status.textContent = mapStatus();
    return;
  }
  try {
    status.textContent = '正在绘制类型热度分布';
    const { mountUniverse } = await import('../vendor/universe-three.js?v=2');
    renderer = mountUniverse({
      canvas,
      context: webglContext,
      nodes: layout.nodes,
      clusters: layout.clusters,
      pixelRatio: innerWidth <= 720 ? Math.min(devicePixelRatio, 1) : Math.min(devicePixelRatio, 1.5),
    });
    canvas.hidden = false;
    modeLink.hidden = false;
    modeLink.textContent = '使用轻量模式';
    const staticParams = new URLSearchParams(window.location.search);
    staticParams.set('render', 'static');
    modeLink.href = `universe.html?${staticParams}`;
    stage.dataset.renderMode = 'webgl';
    status.textContent = mapStatus();
    const nodes = filteredNodes();
    renderer.setVisibleIds(nodes.map(node => node.id), visibleClusters(nodes));
  } catch {
    renderer?.destroy();
    renderer = null;
    webglContext?.getExtension('WEBGL_lose_context')?.loseContext();
    canvas.hidden = true;
    stage.dataset.renderMode = 'static';
    status.textContent = '增强绘制不可用，轻量游戏地图仍可正常使用';
  }
}

document.addEventListener('visibilitychange', () => {
  if (!renderer) return;
  if (document.hidden) renderer.suspend();
  else renderer.resume();
});
window.addEventListener('pagehide', () => renderer?.destroy(), { once: true });
let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { const nodes = filteredNodes(); renderPlot(displayedMapNodes(nodes), nodes); }, 120);
});
window.addEventListener('popstate', () => {
  const next = new URLSearchParams(window.location.search);
  state.query = String(next.get('query') || '').trim().slice(0, 80);
  state.cluster = String(next.get('cluster') || '').trim().slice(0, 40);
  const game = Number(next.get('game')) || 0;
  queryInput.value = state.query;
  clusterSelect.value = layout.clusters.includes(state.cluster) ? state.cluster : '';
  if (!clusterSelect.value) state.cluster = '';
  clearSelection();
  applyFilters();
  if (game && filteredNodes().some(node => node.id === game)) selectGame(game);
});

async function start() {
  try {
    const { manifest, artifact } = await loadUniverse();
    layout = buildUniverseLayout(artifact);
    freshness.textContent = dateTime(manifest.observed_at);
    setupFilters();
    selectedId = filteredNodes().some(node => node.id === state.game) ? state.game : 0;
    applyFilters();
    if (selectedId) selectGame(selectedId);
    await enableWebgl();
  } catch {
    status.textContent = '游戏地图数据暂不可用';
    freshness.textContent = '读取失败';
    stage.dataset.renderMode = 'error';
    canvas.hidden = true;
    count.textContent = '—';
    clear(list);
    list.append(element('div', { className: 'universe-list-empty', text: '请稍后重新加载。游戏分析与原始排行榜仍可正常使用。' }));
  }
}

start();
