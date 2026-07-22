import { chartName, dateTime, platformName } from '../core/format.js';
import { createGameIcon } from '../core/game-icon.js';
import { clear, element } from '../core/safe-dom.js';
import { describeEvent, eventTimestamp, eventTone } from './model.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const ICONS = Object.freeze({
  up: [['path', { d: 'M5 15l7-7 7 7' }], ['path', { d: 'M12 8v11' }]],
  down: [['path', { d: 'M5 9l7 7 7-7' }], ['path', { d: 'M12 5v11' }]],
  arrow: [['path', { d: 'M5 12h14' }], ['path', { d: 'M14 7l5 5-5 5' }]],
  close: [['path', { d: 'M6 6l12 12' }], ['path', { d: 'M18 6L6 18' }]],
  copy: [['rect', { x: '9', y: '9', width: '11', height: '11', rx: '2' }], ['path', { d: 'M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3' }]],
  external: [['path', { d: 'M14 4h6v6' }], ['path', { d: 'M10 14L20 4' }], ['path', { d: 'M20 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4' }]],
  analysis: [['path', { d: 'M4 19V9' }], ['path', { d: 'M10 19V5' }], ['path', { d: 'M16 19v-7' }], ['path', { d: 'M22 19H2' }]],
});

function svgIcon(name, size = 18) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const [tag, attrs] of ICONS[name] || ICONS.arrow) {
    const child = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs).forEach(([key, value]) => child.setAttribute(key, value));
    svg.append(child);
  }
  return svg;
}

function gameIconData(event) {
  return { title: event.game_title || '游戏', icon_source_url: event.game_icon || '' };
}

export function relativeTime(timestamp, generatedAt) {
  const seconds = Math.max(0, Number(generatedAt || 0) - Number(timestamp || 0));
  if (seconds < 60) return '刚刚';
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}分钟前`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}小时前`;
  return `${Math.floor(seconds / 86_400)}天前`;
}

function eventContext(event, generatedAt) {
  return [
    event.platform ? platformName(event.platform) : '',
    event.chart ? chartName(event.chart) : '',
    relativeTime(eventTimestamp(event), generatedAt),
  ].filter(Boolean).join(' · ');
}

export function createEventRow(event, { generatedAt, onOpen }) {
  const description = describeEvent(event);
  const tone = eventTone(event.kind);
  const button = element('button', {
    className: `change-row is-${tone}`,
    attrs: {
      type: 'button',
      'data-event-id': event.id,
      'aria-label': `${event.game_title}，${description}`,
    },
  });
  button.append(createGameIcon(gameIconData(event), { size: 42 }));

  const main = element('span', { className: 'change-row-main' });
  const titleLine = element('span', { className: 'change-row-title-line' });
  titleLine.append(element('strong', { className: 'change-row-title', text: event.game_title }));
  main.append(
    titleLine,
    element('span', { className: 'change-row-description', text: description }),
    element('span', { className: 'change-row-meta', text: eventContext(event, generatedAt) }),
  );

  const tail = element('span', { className: 'change-row-tail', attrs: { 'aria-hidden': 'true' } });
  const toneIcon = element('span', { className: 'change-row-tone' });
  toneIcon.append(svgIcon(tone === 'negative' ? 'down' : 'up', 15));
  const arrow = element('span', { className: 'change-row-arrow' });
  arrow.append(svgIcon('arrow', 17));
  tail.append(toneIcon, arrow);
  button.append(main, tail);
  button.addEventListener('click', () => onOpen(event));
  return button;
}

export function renderEventRows(container, events, options) {
  clear(container);
  events.forEach(event => container.append(createEventRow(event, options)));
}

export function renderFeedState(container, { title, copy, actionLabel, onAction }) {
  clear(container);
  const state = element('div', { className: 'feed-state' });
  state.append(element('strong', { text: title }));
  if (copy) state.append(element('p', { text: copy }));
  if (actionLabel && onAction) {
    const action = element('button', { text: actionLabel, attrs: { type: 'button' } });
    action.addEventListener('click', onAction);
    state.append(action);
  }
  container.append(state);
}

function eventValue(event, value) {
  if (value === null || value === undefined) return '未上榜';
  if (['rank_rise', 'rank_fall', 'entered', 'reentered', 'exited'].includes(event.kind)) return `第${Number(value)}名`;
  if (['score_rise', 'score_fall'].includes(event.kind)) return Number(value).toFixed(1);
  if (['coverage_increase', 'coverage_decrease'].includes(event.kind)) return `${Number(value)}个榜单`;
  return String(value);
}

function ruleCopy(rule) {
  return ({
    rank_threshold_top_10: '前十名变动达到2位',
    rank_threshold_11_50: '第11至50名变动达到5位',
    rank_threshold_51_plus: '第51名后变动达到10位',
    first_appearance: '首次出现在该平台榜单',
    seen_appearance: '曾经上榜，本轮重新出现',
    complete_chart_absence: '前后两次采集均完整，确认不再上榜',
    'score_delta_0.1': '评分变化达到0.1',
    chart_coverage_change: '覆盖的榜单数量增加',
    complete_chart_coverage_change: '相关榜单采集完整，覆盖数量减少',
  }[rule] || '达到已公开的记录规则');
}

function fact(label, value) {
  const wrapper = element('div', { className: 'detail-fact' });
  wrapper.append(element('dt', { text: label }), element('dd', { text: value }));
  return wrapper;
}

async function copyCurrentUrl(feedback) {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
    await navigator.clipboard.writeText(window.location.href);
    feedback.textContent = '链接已复制';
  } catch {
    feedback.textContent = '复制失败，请使用浏览器地址栏';
  }
}

export function createDetailSurface({ onRequestClose }) {
  const dialog = element('dialog', { className: 'change-dialog', attrs: { 'aria-labelledby': 'changeDetailTitle' } });
  const detail = element('article', { className: 'change-detail' });
  const header = element('header', { className: 'change-detail-header' });
  const close = element('button', {
    className: 'icon-action',
    attrs: { type: 'button', 'aria-label': '关闭变化详情', title: '关闭变化详情' },
  });
  close.append(svgIcon('close', 19));
  const headerCopy = element('div');
  headerCopy.append(element('strong', { text: '变化详情' }), element('span', { text: '记录依据与观察时间' }));
  header.append(close, headerCopy);
  const body = element('div', { className: 'change-detail-body' });
  const actions = element('footer', { className: 'change-detail-actions' });
  const actionRow = element('div', { className: 'detail-action-row' });
  const copyButton = element('button', {
    className: 'icon-action',
    attrs: { type: 'button', 'aria-label': '复制变化链接', title: '复制变化链接' },
  });
  copyButton.append(svgIcon('copy', 18));
  const sourceLink = element('a', { className: 'detail-link', attrs: { target: '_blank', rel: 'noreferrer' } });
  sourceLink.append(svgIcon('external', 16), document.createTextNode('打开 TapTap 游戏页'));
  const analysisLink = element('a', { className: 'detail-link' });
  analysisLink.append(svgIcon('analysis', 16), document.createTextNode('在游戏分析中查看'));
  actionRow.append(copyButton, sourceLink, analysisLink);
  const feedback = element('div', { className: 'detail-feedback', attrs: { 'aria-live': 'polite' } });
  actions.append(actionRow, feedback);
  detail.append(header, body, actions);
  dialog.append(detail);
  document.body.append(dialog);

  close.addEventListener('click', onRequestClose);
  dialog.addEventListener('cancel', event => { event.preventDefault(); onRequestClose(); });
  copyButton.addEventListener('click', () => copyCurrentUrl(feedback));

  function show(event, feed) {
    clear(body);
    feedback.textContent = '';
    const game = element('div', { className: 'change-detail-game' });
    game.append(createGameIcon(gameIconData(event), { size: 52 }));
    const gameCopy = element('div');
    gameCopy.append(
      element('h2', { text: event.game_title, attrs: { id: 'changeDetailTitle' } }),
      element('p', { text: eventContext(event, feed.generated_at) }),
    );
    game.append(gameCopy);
    body.append(game, element('p', { className: 'change-detail-summary', text: describeEvent(event) }));

    const values = element('div', { className: 'change-values' });
    for (const [label, value] of [['变化前', event.before], ['变化后', event.after]]) {
      const item = element('div', { className: 'change-value' });
      item.append(element('span', { text: label }), element('strong', { text: eventValue(event, value) }));
      values.append(item);
    }
    body.append(values);

    const facts = element('dl', { className: 'detail-facts' });
    facts.append(
      fact('首次观察', dateTime(event.first_observed_at ?? event.observed_at)),
      fact('最近观察', dateTime(event.last_observed_at ?? event.observed_at)),
      fact('平台与榜单', [event.platform ? platformName(event.platform) : '', event.chart ? chartName(event.chart) : ''].filter(Boolean).join(' · ') || '跨榜单变化'),
      fact('连续记录', `${Number(event.occurrences || 1)}次`),
      fact('记录依据', ruleCopy(event.rule)),
      fact('采集状态', feed.partial ? '本轮采集不完整，缺失类负面事件已暂停' : '本轮采集完整'),
    );
    body.append(facts);

    sourceLink.href = event.game_url || 'https://www.taptap.cn/';
    sourceLink.hidden = !event.game_url;
    const analysisState = new URLSearchParams({
      scope: event.scope === 'made' ? 'made' : 'all',
      query: event.game_title || '',
    });
    analysisLink.href = `analysis.html?${analysisState.toString()}`;
    if (!dialog.open) dialog.showModal();
    close.focus();
  }

  function hide() {
    if (dialog.open) dialog.close();
  }

  return { dialog, show, hide };
}
