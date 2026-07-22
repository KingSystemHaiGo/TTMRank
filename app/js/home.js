import { loadChanges } from './changes/data-client.js';
import { DEFAULT_CHANGE_FILTERS, filterEvents, topEvents } from './changes/model.js';
import { parseChangeState, serializeChangeState } from './changes/state.js';
import { createDetailSurface, renderEventRows, renderFeedState } from './changes/view.js';

const feedNode = document.getElementById('changeFeed');
const partialNotice = document.getElementById('partialNotice');
const allChangesLink = document.getElementById('allChangesLink');
const freshness = document.getElementById('freshness');
const rangeButtons = [...document.querySelectorAll('[data-range]')];

let state = homeState(parseChangeState(window.location.search));
let currentFeed = null;
let detailWasPushed = false;

const detail = createDetailSurface({ onRequestClose: closeDetail });

function homeState(parsed) {
  return {
    ...DEFAULT_CHANGE_FILTERS,
    range: parsed.range,
    event: parsed.event,
  };
}

function compact(value) {
  return new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(value) || 0);
}

function pageUrl(nextState = state) {
  return `${window.location.pathname}${serializeChangeState(nextState)}`;
}

function syncRange() {
  rangeButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.range === state.range)));
  const completeState = { ...state, event: '' };
  allChangesLink.href = `changes.html${serializeChangeState(completeState)}`;
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
  syncRange();
  if (!currentFeed) return;
  partialNotice.hidden = !currentFeed.partial;
  if (currentFeed.status === 'baseline') {
    renderFeedState(feedNode, {
      title: '正在建立历史比较，下一次采集后开始记录变化',
      copy: '当前快照已发布，但还没有可比较的上一轮数据。',
    });
    showStateDetail();
    return;
  }
  const filtered = filterEvents(currentFeed.events, state, currentFeed.generated_at);
  const visible = topEvents(filtered, 5);
  if (!visible.length) {
    renderFeedState(feedNode, {
      title: '这段时间没有达到记录阈值的变化',
      copy: '可以切换时间范围，或前往完整情报查看其他筛选。',
    });
  } else {
    renderEventRows(feedNode, visible, { generatedAt: currentFeed.generated_at, onOpen: openDetail });
  }
  showStateDetail();
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

async function loadSnapshot(manifest) {
  document.getElementById('gameCount').textContent = compact(manifest.game_count);
  document.getElementById('appearanceCount').textContent = compact(manifest.appearance_count);
  try {
    const response = await fetch(`data/v2/${manifest.analysis_file}`, { cache: 'no-cache' });
    if (!response.ok) return;
    const analysis = await response.json();
    const makerCount = analysis.games.filter(game => game.is_taptap_made).length;
    document.getElementById('makerCount').textContent = compact(makerCount);
  } catch {
    // Snapshot counts are secondary; feed publication remains usable.
  }
}

async function load() {
  currentFeed = null;
  partialNotice.hidden = true;
  renderFeedState(feedNode, { title: '正在读取最新变化' });
  try {
    const { manifest, feed } = await loadChanges();
    currentFeed = feed;
    freshness.textContent = `最近采集 ${manifest.updated_at}`;
    loadSnapshot(manifest);
    render();
  } catch {
    freshness.textContent = '变化数据暂不可用';
    renderFeedState(feedNode, {
      title: '暂时无法读取变化数据',
      copy: '已保留游戏分析和原始排行榜入口。',
      actionLabel: '重新读取',
      onAction: load,
    });
  }
}

rangeButtons.forEach(button => button.addEventListener('click', () => {
  if (state.range === button.dataset.range) return;
  state.range = button.dataset.range;
  state.event = '';
  detailWasPushed = false;
  detail.hide();
  history.replaceState({ ...(history.state || {}), scrollY: window.scrollY }, '', pageUrl());
  render();
}));

window.addEventListener('popstate', event => {
  state = homeState(parseChangeState(window.location.search));
  detailWasPushed = false;
  render();
  if (!state.event) {
    const scrollY = Number(event.state?.scrollY);
    if (Number.isFinite(scrollY)) requestAnimationFrame(() => window.scrollTo(0, scrollY));
  }
});

history.replaceState({ ...(history.state || {}), scrollY: window.scrollY }, '', pageUrl());
syncRange();
load();
