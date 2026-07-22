import { compactNumber, dateTime, decimal } from '../core/format.js';
import { createGameIcon } from '../core/game-icon.js';
import { clear, element } from '../core/safe-dom.js';
import { loadUniverse } from './data-client.js';
import { buildUniverseLayout, renderMode } from './model.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const canvas = document.getElementById('universeCanvas');
const staticPlot = document.getElementById('universeStatic');
const stage = document.getElementById('universeStage');
const status = document.getElementById('universeStatus');
const freshness = document.getElementById('universeFreshness');
const list = document.getElementById('universeList');
const count = document.getElementById('universeCount');
const queryInput = document.getElementById('universeQuery');
const clusterSelect = document.getElementById('universeCluster');
const clearFilters = document.getElementById('universeClear');
const pauseButton = document.getElementById('universePause');
const resetButton = document.getElementById('universeReset');
const modeLink = document.getElementById('universeModeLink');
const legend = document.getElementById('universeLegend');
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
let autoRotating = !matchMedia('(prefers-reduced-motion: reduce)').matches;

const COLORS = ['#20d9ca', '#7b8cff', '#f3b65a', '#e8788d', '#77be67', '#b388ed', '#5bb7e8', '#e79a66', '#8d9ca2'];

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
    return canvas.getContext('webgl2', { alpha: false, antialias: false, powerPreference: 'high-performance' })
      || canvas.getContext('webgl', { alpha: false, antialias: false, powerPreference: 'high-performance' });
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

function svg(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, String(value)));
  return node;
}

function project(point) {
  return {
    x: 500 + point.x * 20 - point.z * 8,
    y: 290 - point.y * 38 + point.z * 3.2,
  };
}

function renderStatic(nodes) {
  clear(staticPlot);
  staticPlot.setAttribute('viewBox', '0 0 1000 580');
  const floor = svg('g', { class: 'universe-static-grid', 'aria-hidden': 'true' });
  [120, 220, 330].forEach(radius => floor.append(svg('ellipse', { cx: 500, cy: 320, rx: radius, ry: radius * 0.32 })));
  floor.append(svg('line', { x1: 500, y1: 70, x2: 500, y2: 500 }));
  staticPlot.append(floor);
  const group = svg('g');
  nodes.forEach(point => {
    const position = project(point);
    const circle = svg('circle', {
      cx: position.x,
      cy: position.y,
      r: 4 + point.size * 8,
      fill: clusterColor(point.cluster),
      class: point.id === selectedId ? 'is-selected' : '',
      'data-game-id': point.id,
      tabindex: 0,
      role: 'button',
      'aria-label': `${point.title}，${point.cluster}，评分${point.score ?? '暂无'}，热度${compactNumber(point.heat)}`,
    });
    circle.append(svg('title'));
    circle.firstChild.textContent = point.title;
    circle.addEventListener('click', () => selectGame(point.id, { push: true }));
    circle.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        selectGame(point.id, { push: true });
      }
    });
    group.append(circle);
  });
  staticPlot.append(group);
}

function filteredNodes() {
  const query = state.query.toLocaleLowerCase('zh-CN');
  return layout.nodes.filter(node => {
    if (state.cluster && node.cluster !== state.cluster) return false;
    if (!query) return true;
    return [node.title, node.cluster, ...node.tags].join(' ').toLocaleLowerCase('zh-CN').includes(query);
  });
}

function renderLegend() {
  clear(legend);
  layout.clusters.forEach(cluster => {
    const item = element('span', { className: 'universe-legend-item' });
    item.append(element('i', { attrs: { style: `--cluster:${clusterColor(cluster)}` } }), document.createTextNode(cluster));
    legend.append(item);
  });
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

function selectGame(id, { push = false } = {}) {
  const index = layout.nodes.findIndex(node => node.id === Number(id));
  if (index < 0) return;
  selectedId = layout.nodes[index].id;
  state.game = selectedId;
  syncUrl({ push });
  renderer?.select(index, { notify: false });
  showDetail(layout.nodes[index]);
  renderList(filteredNodes());
  if (staticPlot.hidden === false) renderStatic(filteredNodes());
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
  clearFilters.hidden = !state.query && !state.cluster;
  renderList(nodes);
  renderStatic(nodes);
  renderer?.setVisibleIds(nodes.map(node => node.id));
  syncUrl();
}

function setupFilters() {
  queryInput.value = state.query;
  clear(clusterSelect);
  clusterSelect.append(element('option', { text: '全部类型', attrs: { value: '' } }));
  layout.clusters.forEach(cluster => clusterSelect.append(element('option', { text: cluster, attrs: { value: cluster } })));
  if (layout.clusters.includes(state.cluster)) clusterSelect.value = state.cluster;
  else state.cluster = '';
  queryInput.addEventListener('input', () => { state.query = queryInput.value.trim(); state.game = 0; applyFilters(); });
  clusterSelect.addEventListener('change', () => { state.cluster = clusterSelect.value; state.game = 0; applyFilters(); });
  clearFilters.addEventListener('click', () => {
    state.query = '';
    state.cluster = '';
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
    canvas.setAttribute('aria-hidden', 'true');
    staticPlot.hidden = false;
    staticPlot.removeAttribute('aria-hidden');
    pauseButton.hidden = true;
    resetButton.hidden = true;
    modeLink.hidden = state.requestedMode !== 'static';
    modeLink.textContent = '尝试动态宇宙';
    const dynamicParams = new URLSearchParams(window.location.search);
    dynamicParams.delete('render');
    modeLink.href = `universe.html${dynamicParams.size ? `?${dynamicParams}` : ''}`;
    stage.dataset.renderMode = 'static';
    status.textContent = state.requestedMode === 'static' ? '静态投影已就绪' : '当前设备使用轻量静态投影';
    return;
  }
  try {
    status.textContent = '正在启动游戏宇宙';
    const { mountUniverse } = await import('../vendor/universe-three.js');
    renderer = mountUniverse({
      canvas,
      context: webglContext,
      nodes: layout.nodes,
      clusters: layout.clusters,
      onSelect: node => selectGame(node.id, { push: true }),
      reducedMotion: !autoRotating,
      pixelRatio: innerWidth <= 720 ? Math.min(devicePixelRatio, 1) : Math.min(devicePixelRatio, 1.5),
    });
    staticPlot.hidden = true;
    staticPlot.setAttribute('aria-hidden', 'true');
    canvas.hidden = false;
    canvas.removeAttribute('aria-hidden');
    pauseButton.hidden = false;
    pauseButton.textContent = autoRotating ? '暂停旋转' : '开始旋转';
    pauseButton.setAttribute('aria-pressed', String(!autoRotating));
    resetButton.hidden = false;
    modeLink.hidden = false;
    modeLink.textContent = '使用静态投影';
    const staticParams = new URLSearchParams(window.location.search);
    staticParams.set('render', 'static');
    modeLink.href = `universe.html?${staticParams}`;
    stage.dataset.renderMode = 'webgl';
    status.textContent = '动态宇宙已就绪，可拖动旋转并点击节点';
    if (selectedId) renderer.select(layout.nodes.findIndex(node => node.id === selectedId), { notify: false });
    renderer.setVisibleIds(filteredNodes().map(node => node.id));
  } catch {
    renderer?.destroy();
    renderer = null;
    webglContext?.getExtension('WEBGL_lose_context')?.loseContext();
    canvas.hidden = true;
    canvas.setAttribute('aria-hidden', 'true');
    staticPlot.hidden = false;
    staticPlot.removeAttribute('aria-hidden');
    pauseButton.hidden = true;
    resetButton.hidden = true;
    stage.dataset.renderMode = 'static';
    status.textContent = '动态渲染不可用，已切换到静态投影';
  }
}

pauseButton.addEventListener('click', () => {
  autoRotating = !autoRotating;
  if (autoRotating) renderer?.resume();
  else renderer?.pause();
  pauseButton.textContent = autoRotating ? '暂停旋转' : '继续旋转';
  pauseButton.setAttribute('aria-pressed', String(!autoRotating));
});
resetButton.addEventListener('click', () => renderer?.resetCamera());
document.addEventListener('visibilitychange', () => {
  if (!renderer) return;
  if (document.hidden) renderer.suspend();
  else if (autoRotating) renderer.resume();
});
window.addEventListener('pagehide', () => renderer?.destroy(), { once: true });
window.addEventListener('popstate', () => {
  const next = new URLSearchParams(window.location.search);
  const game = Number(next.get('game')) || 0;
  if (game) selectGame(game);
});

async function start() {
  try {
    const { manifest, artifact } = await loadUniverse();
    layout = buildUniverseLayout(artifact);
    freshness.textContent = dateTime(manifest.observed_at);
    renderLegend();
    setupFilters();
    selectedId = layout.nodes.some(node => node.id === state.game) ? state.game : 0;
    applyFilters();
    if (selectedId) selectGame(selectedId);
    await enableWebgl();
  } catch {
    status.textContent = '游戏宇宙数据暂不可用';
    freshness.textContent = '读取失败';
    stage.dataset.renderMode = 'error';
    staticPlot.hidden = true;
    canvas.hidden = true;
    count.textContent = '—';
    clear(list);
    list.append(element('div', { className: 'universe-list-empty', text: '请稍后重新加载。游戏分析与原始排行榜仍可正常使用。' }));
  }
}

start();
