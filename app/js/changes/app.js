import { loadChanges, probeChanges } from './data-client.js';
import { createLiveRefresh, freshnessText } from './live-refresh.js';
import { DEFAULT_CHANGE_FILTERS, filterEvents } from './model.js';
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

let state = parseChangeState(window.location.search);
let currentFeed = null;
let currentManifest = null;
let detailWasPushed = false;
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
  typeSelect.value = state.type;
  platformSelect.value = state.platform;
  queryInput.value = state.query;
  clearButton.hidden = !filtersActive();
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
    renderFeedState(feedNode, {
      title: '正在建立历史比较，下一次采集后开始记录变化',
      copy: '当前快照已发布，但还没有可比较的上一轮数据。',
    });
    showStateDetail();
    return;
  }

  const events = filterEvents(currentFeed.events, state, currentFeed.generated_at);
  countNode.textContent = `${events.length}条`;
  if (!events.length) {
    renderFeedState(feedNode, {
      title: '这段时间没有达到记录阈值的变化',
      copy: filtersActive() ? '可以调整或清除筛选。' : '下一轮采集后会继续检查。',
    });
  } else {
    renderEventRows(feedNode, events, { generatedAt: currentFeed.generated_at, onOpen: openDetail });
  }
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
typeSelect.addEventListener('change', () => changeFilter('type', typeSelect.value));
platformSelect.addEventListener('change', () => changeFilter('platform', platformSelect.value));
queryInput.addEventListener('input', () => changeFilter('query', queryInput.value.trim()));
clearButton.addEventListener('click', () => {
  state = { ...DEFAULT_CHANGE_FILTERS };
  detailWasPushed = false;
  detail.hide();
  replaceUrl();
  render();
});

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
