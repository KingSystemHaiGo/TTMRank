import { loadChanges, probeChanges } from './data-client.js';
import { createLiveRefresh, freshnessText } from './live-refresh.js';
import { DEFAULT_CHANGE_FILTERS, filterEvents } from './model.js';
import { buildChangeMap } from './map-model.js';
import { parseChangeState, serializeChangeState } from './state.js';
import { createDetailSurface, renderEventRows, renderFeedState } from './view.js';

const feedNode = document.getElementById('changesFeed');
const partialNotice = document.getElementById('changesPartialNotice');
const freshness = document.getElementById('changesFreshness');
const countNode = document.getElementById('changeCount');
const typeSelect = document.getElementById('changeType');
const platformSelect = document.getElementById('changePlatform');
const queryInput = document.getElementById('changeQuery');
const clearButton = document.getElementById('clearChanges');
const rangeButtons = [...document.querySelectorAll('[data-range]')];
const scopeButtons = [...document.querySelectorAll('[data-scope]')];
const viewButtons = [...document.querySelectorAll('[data-view]')];
const listView = document.getElementById('changesListView');
const mapView = document.getElementById('changesMapView');
const mapHost = document.getElementById('changeMapCanvas');
const mapState = document.getElementById('changeMapState');
const mapEvents = document.getElementById('changeMapEvents');
const mapStart = document.getElementById('changeMapStart');

let state = parseChangeState(window.location.search);
let currentFeed = null;
let currentManifest = null;
let detailWasPushed = false;
let mapRenderer = null;
let mapImport = null;
let mapGeneration = 0;
let mapContext = null;
let mapCanvas = null;
const detail = createDetailSurface({ onRequestClose: closeDetail });

function pageUrl(nextState = state) {
  return `${window.location.pathname}${serializeChangeState(nextState)}`;
}

function filtersActive() {
  return ['range', 'scope', 'type', 'platform', 'query']
    .some(key => state[key] !== DEFAULT_CHANGE_FILTERS[key]);
}

function syncControls() {
  rangeButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.range === state.range)));
  scopeButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.scope === state.scope)));
  viewButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === state.view)));
  typeSelect.value = state.type;
  platformSelect.value = state.platform;
  queryInput.value = state.query;
  clearButton.hidden = !filtersActive();
}

function devicePixelRatioBudget() {
  return window.innerWidth <= 720 ? Math.min(window.devicePixelRatio || 1, 1) : Math.min(window.devicePixelRatio || 1, 1.5);
}

function mapLabel(timestamp) {
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(timestamp * 1000));
}

function destroyMap() {
  mapGeneration += 1;
  mapRenderer?.destroy();
  if (!mapRenderer) mapContext?.getExtension('WEBGL_lose_context')?.loseContext();
  mapRenderer = null;
  mapContext = null;
  mapCanvas = null;
  mapHost.replaceChildren();
  mapState.classList.remove('is-ready');
  mapState.textContent = '切换到图谱后加载可视化引擎';
}

async function renderMap(events) {
  const generation = ++mapGeneration;
  const width = Math.max(320, Math.round(mapHost.clientWidth || 960));
  const height = Math.max(300, Math.round(mapHost.clientHeight || 410));
  const model = buildChangeMap(events, { generatedAt: currentFeed.generated_at, range: state.range, width, height });
  mapStart.textContent = mapLabel(model.start);
  renderEventRows(mapEvents, [...events].sort((a, b) => Number(b.importance || 0) - Number(a.importance || 0)).slice(0, 8), {
    generatedAt: currentFeed.generated_at,
    onOpen: openDetail,
  });
  if (!events.length) renderFeedState(mapEvents, { title: '当前筛选下没有可绘制的变化' });
  if (mapRenderer) {
    mapRenderer.update(model);
    mapRenderer.select(state.event);
    return;
  }
  if (navigator.connection?.saveData || Number(navigator.hardwareConcurrency || 4) <= 2) {
    mapState.textContent = '当前设备使用重点事件列表，未加载图谱引擎';
    return;
  }
  try {
    mapCanvas = document.createElement('canvas');
    mapContext = mapCanvas.getContext('webgl2', { antialias: false, powerPreference: 'low-power' });
  } catch {
    mapContext = null;
    mapCanvas = null;
  }
  if (!mapContext) {
    mapState.textContent = 'WebGL 不可用，重点事件列表仍可正常查看';
    return;
  }
  mapState.textContent = '正在加载变化图谱';
  try {
    mapImport ||= import('../vendor/change-map-pixi.js');
    const { mountChangeMap } = await mapImport;
    if (generation !== mapGeneration || state.view !== 'map') return;
    mapRenderer = await mountChangeMap({
      container: mapHost,
      canvas: mapCanvas,
      context: mapContext,
      model,
      pixelRatio: devicePixelRatioBudget(),
      onSelect: event => openDetail(event),
    });
    if (generation !== mapGeneration || state.view !== 'map') {
      mapRenderer.destroy();
      mapRenderer = null;
      return;
    }
    mapRenderer.select(state.event);
    mapState.classList.add('is-ready');
    mapState.textContent = '变化图谱已就绪';
  } catch {
    mapImport = null;
    mapState.classList.remove('is-ready');
    mapState.textContent = '图谱渲染不可用，重点事件列表仍可正常查看';
  }
}

function findEvent(eventId) {
  return currentFeed?.events.find(event => event.id === eventId) || null;
}

function showStateDetail() {
  const event = state.event ? findEvent(state.event) : null;
  if (event) detail.show(event, currentFeed);
  else detail.hide();
}

function render() {
  syncControls();
  if (!currentFeed) return;
  partialNotice.hidden = !currentFeed.partial;
  if (currentFeed.status === 'baseline') {
    countNode.textContent = '0条';
    listView.hidden = state.view !== 'list';
    mapView.hidden = state.view !== 'map';
    renderFeedState(feedNode, {
      title: '正在建立历史比较，下一次采集后开始记录变化',
      copy: '当前快照已发布，但还没有可比较的上一轮数据。',
    });
    if (state.view === 'map') renderMap([]);
    else destroyMap();
    showStateDetail();
    return;
  }

  const events = filterEvents(currentFeed.events, state, currentFeed.generated_at);
  countNode.textContent = `${events.length}条`;
  listView.hidden = state.view !== 'list';
  mapView.hidden = state.view !== 'map';
  if (state.view === 'list') destroyMap();
  if (!events.length) {
    renderFeedState(feedNode, {
      title: '这段时间没有达到记录阈值的变化',
      copy: filtersActive() ? '可以调整或清除筛选。' : '下一轮采集后会继续检查。',
    });
  } else {
    renderEventRows(feedNode, events, { generatedAt: currentFeed.generated_at, onOpen: openDetail });
  }
  if (state.view === 'map') renderMap(events);
  showStateDetail();
}

function replaceUrl() {
  history.replaceState({ ...(history.state || {}), scrollY: window.scrollY }, '', pageUrl());
}

function changeFilter(key, value) {
  if (state[key] === value && !state.event) return;
  state[key] = value;
  state.event = '';
  detailWasPushed = false;
  detail.hide();
  replaceUrl();
  render();
}

function openDetail(event) {
  history.replaceState({ ...(history.state || {}), scrollY: window.scrollY }, '', pageUrl());
  state.event = event.id;
  history.pushState({ detail: true }, '', pageUrl());
  detailWasPushed = true;
  detail.show(event, currentFeed);
  mapRenderer?.select(event.id);
}

function closeDetail() {
  if (detailWasPushed) {
    history.back();
    return;
  }
  state.event = '';
  history.replaceState({ ...(history.state || {}), detail: false }, '', pageUrl());
  detail.hide();
}

async function load() {
  currentFeed = null;
  partialNotice.hidden = true;
  countNode.textContent = '—';
  renderFeedState(feedNode, { title: '正在读取最新变化' });
  try {
    const { manifest, feed } = await loadChanges();
    currentManifest = manifest;
    currentFeed = feed;
    freshness.textContent = freshnessText(manifest).replace(/^最近采集 /, '');
    render();
    liveRefresh.start();
  } catch {
    freshness.textContent = '变化数据暂不可用';
    renderFeedState(feedNode, {
      title: '暂时无法读取变化数据',
      copy: '筛选状态已保留，可以重新读取。',
      actionLabel: '重新读取',
      onAction: load,
    });
  }
}

async function checkForUpdate() {
  if (!currentManifest) return false;
  const next = await probeChanges(currentManifest);
  if (!next.changed) {
    freshness.textContent = freshnessText(next.manifest).replace(/^最近采集 /, '');
    return false;
  }
  currentManifest = next.manifest;
  currentFeed = next.feed;
  freshness.textContent = freshnessText(next.manifest).replace(/^最近采集 /, '');
  render();
  return true;
}

const liveRefresh = createLiveRefresh({
  check: checkForUpdate,
  onError: () => {
    if (currentManifest) {
      freshness.textContent = freshnessText(currentManifest).replace(/^最近采集 /, '');
    }
  },
});

rangeButtons.forEach(button => button.addEventListener('click', () => changeFilter('range', button.dataset.range)));
scopeButtons.forEach(button => button.addEventListener('click', () => changeFilter('scope', button.dataset.scope)));
viewButtons.forEach(button => button.addEventListener('click', () => changeFilter('view', button.dataset.view)));
typeSelect.addEventListener('change', () => changeFilter('type', typeSelect.value));
platformSelect.addEventListener('change', () => changeFilter('platform', platformSelect.value));
queryInput.addEventListener('input', () => changeFilter('query', queryInput.value.trim()));
clearButton.addEventListener('click', () => {
  state = { ...DEFAULT_CHANGE_FILTERS, view: state.view };
  detailWasPushed = false;
  detail.hide();
  replaceUrl();
  render();
});

let resizeTimer = 0;
window.addEventListener('resize', () => {
  if (!mapRenderer || state.view !== 'map' || !currentFeed) return;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const events = filterEvents(currentFeed.events, state, currentFeed.generated_at);
    renderMap(events);
  }, 120);
});
window.addEventListener('pagehide', destroyMap, { once: true });

window.addEventListener('popstate', event => {
  state = parseChangeState(window.location.search);
  detailWasPushed = false;
  render();
  if (!state.event) {
    const scrollY = Number(event.state?.scrollY);
    if (Number.isFinite(scrollY)) requestAnimationFrame(() => window.scrollTo(0, scrollY));
  }
});

history.replaceState({ ...(history.state || {}), scrollY: window.scrollY }, '', pageUrl());
syncControls();
load();
