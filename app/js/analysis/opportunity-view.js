import { compactNumber, decimal } from '../core/format.js';
import { element, clear } from '../core/safe-dom.js';

export function renderOpportunities(container, signals) {
  clear(container);
  signals.slice(0, 6).forEach((track, index) => {
    container.append(element('article', { className: 'opportunity-row', children: [
      element('div', { className: 'opportunity-rank num', text: String(index + 1).padStart(2, '0') }),
      element('div', { className: 'opportunity-main', children: [
        element('h3', { text: track.name }),
        element('p', { text: `${track.count} 款游戏 · 日均热度中位 ${compactNumber(track.dailyMedian)} · 评分中位 ${decimal(track.scoreMedian)}` }),
        element('small', { text: `${track.confidence.label} · 当前热度中位 ${compactNumber(track.heatMedian)} · 榜单覆盖中位 ${decimal(track.coverageMedian)}` }),
      ] }),
      element('div', { className: 'opportunity-signal', children: [element('span', { text: '综合表现' }), element('strong', { text: track.signalScore })] }),
    ] }));
  });
}
