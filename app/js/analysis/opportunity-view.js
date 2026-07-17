import { compactNumber, decimal } from '../core/format.js';
import { element, clear } from '../core/safe-dom.js';

export function renderOpportunities(container, signals, openDetail) {
  clear(container);
  signals.slice(0, 6).forEach((track, index) => {
    const representativeGames = element('div', { className: 'signal-games', children: [
      element('span', { text: '代表游戏' }),
      ...track.representatives.map(game => {
        const button = element('button', { className: 'signal-game', text: game.title, attrs: { type: 'button', 'aria-label': `查看 ${game.title} 详情` } });
        if (openDetail) button.addEventListener('click', () => openDetail(game.id, button));
        return button;
      }),
    ] });
    container.append(element('article', { className: 'opportunity-row', children: [
      element('div', { className: 'opportunity-rank num', text: String(index + 1).padStart(2, '0') }),
      element('div', { className: 'opportunity-main', children: [
        element('h3', { text: track.name }),
        element('p', { text: `${track.count} 款游戏 · 日均热度中位 ${compactNumber(track.dailyMedian)} · 评分中位 ${decimal(track.scoreMedian)}` }),
        element('small', { text: `${track.confidence.label} · 当前热度中位 ${compactNumber(track.heatMedian)} · 榜单覆盖中位 ${decimal(track.coverageMedian)}` }),
      ] }),
      element('div', { className: 'opportunity-signal', children: [element('span', { text: '综合表现' }), element('strong', { text: track.signalScore })] }),
      representativeGames,
    ] }));
  });
}
