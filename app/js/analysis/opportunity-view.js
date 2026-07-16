import { compactNumber, decimal } from '../core/format.js';
import { element, clear } from '../core/safe-dom.js';

const score = (label, value, tone) => element('div', { className: `opportunity-score ${tone}`, children: [
  element('span', { text: label }), element('strong', { text: value }),
] });

export function renderOpportunities(container, opportunities) {
  clear(container);
  opportunities.slice(0, 6).forEach((track, index) => {
    const evidence = track.personalEvidenceCount > 0
      ? track.decisionConfidence.label
      : '个人 / 小队证据不足（N=0，仅按画像适配）';
    container.append(element('article', { className: 'opportunity-row', children: [
      element('div', { className: 'opportunity-rank num', text: String(index + 1).padStart(2, '0') }),
      element('div', { className: 'opportunity-main', children: [
        element('h3', { text: track.name }),
        element('p', { text: `${track.count} 款制造市场样本 · 日均热度中位 ${compactNumber(track.dailyMedian)} · 评分中位 ${decimal(track.scoreMedian)}` }),
        element('small', { text: `${track.marketConfidence.label}；${evidence}；大型 / 专业参照 N=${track.referenceCount}；身份待核实 N=${track.unknownCount}。` }),
      ] }),
      element('div', { className: 'opportunity-scores', children: [score('市场机会', track.marketScore, 'market'), score('个人适配', track.personalScore, 'fit')] }),
    ] }));
  });
}
