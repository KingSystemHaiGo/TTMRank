import { compactNumber } from '../core/format.js';
import { clear, element } from '../core/safe-dom.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function finiteNonNegative(value) {
  const number = Number(value);
  return value !== null && value !== '' && Number.isFinite(number) && number >= 0 ? number : null;
}

export function buildHeatBuckets(values, bucketCount = 12) {
  const samples = values.map(finiteNonNegative).filter(value => value !== null);
  const count = Math.max(1, Math.floor(bucketCount));
  const maximum = Math.max(...samples, 0);
  const size = maximum > 0 ? maximum / count : 1;
  const buckets = Array.from({ length: count }, (_, index) => ({
    start: index * size,
    end: (index + 1) * size,
    count: 0,
  }));
  samples.forEach(value => {
    const index = Math.min(Math.floor(value / size), count - 1);
    buckets[index].count += 1;
  });
  return buckets;
}

export function buildScatterPoints(games, { width = 640, height = 300, padding = 36 } = {}) {
  const valid = games.filter(game => {
    const score = Number(game.score);
    const heat = Number(game.heat);
    return game.score !== null && Number.isFinite(score) && score >= 0 && score <= 10
      && Number.isFinite(heat) && heat > 0;
  });
  const logMaximum = Math.max(...valid.map(game => Math.log10(Number(game.heat) + 1)), 1);
  const plotWidth = Math.max(1, width - padding * 2);
  const plotHeight = Math.max(1, height - padding * 2);
  return valid.map(game => {
    const logHeat = Math.log10(Number(game.heat) + 1);
    return {
      game,
      x: padding + Number(game.score) / 10 * plotWidth,
      y: height - padding - logHeat / logMaximum * plotHeight,
      radius: Math.max(3, Math.min(9, 3 + logHeat)),
    };
  });
}

function svgElement(tag, attributes = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, String(value)));
  return node;
}

function renderHeatHistogram(container, games) {
  const buckets = buildHeatBuckets(games.map(game => game.heat));
  const largest = Math.max(...buckets.map(bucket => bucket.count), 1);
  const histogram = element('div', { className: 'native-histogram' });
  buckets.forEach(bucket => {
    const label = `${compactNumber(bucket.start)}–${compactNumber(bucket.end)}`;
    histogram.append(element('div', {
      className: 'histogram-column',
      attrs: { title: `${label}：${bucket.count} 款` },
      children: [
        element('span', { className: 'histogram-count num', text: bucket.count }),
        element('i', { attrs: { style: `height:${Math.max(2, bucket.count / largest * 100)}%` } }),
        element('small', { text: compactNumber(bucket.start) }),
      ],
    }));
  });
  container.setAttribute('role', 'img');
  container.setAttribute('aria-label', `热度分布直方图，共 ${games.length} 款游戏，最高区间样本 ${largest} 款。`);
  container.append(histogram);
}

function renderScatter(container, games, metrics) {
  const width = 640;
  const height = 300;
  const padding = 38;
  const points = buildScatterPoints(games, { width, height, padding });
  const svg = svgElement('svg', { viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: 'none', 'aria-hidden': 'true' });
  const plotWidth = width - padding * 2;
  const plotHeight = height - padding * 2;

  for (let index = 0; index <= 5; index += 1) {
    const x = padding + index / 5 * plotWidth;
    const line = svgElement('line', { x1: x, y1: padding, x2: x, y2: height - padding, class: 'scatter-grid' });
    svg.append(line);
    const label = svgElement('text', { x, y: height - 12, class: 'scatter-label', 'text-anchor': 'middle' });
    label.textContent = String(index * 2);
    svg.append(label);
  }
  for (let index = 0; index <= 4; index += 1) {
    const y = padding + index / 4 * plotHeight;
    svg.append(svgElement('line', { x1: padding, y1: y, x2: width - padding, y2: y, class: 'scatter-grid' }));
  }

  if (Number.isFinite(Number(metrics.scoreMedian))) {
    const x = padding + Number(metrics.scoreMedian) / 10 * plotWidth;
    svg.append(svgElement('line', { x1: x, y1: padding, x2: x, y2: height - padding, class: 'scatter-median' }));
  }
  const maxLog = Math.max(...points.map(point => Math.log10(Number(point.game.heat) + 1)), 1);
  if (Number(metrics.heatMedian) > 0) {
    const y = height - padding - Math.log10(Number(metrics.heatMedian) + 1) / maxLog * plotHeight;
    svg.append(svgElement('line', { x1: padding, y1: y, x2: width - padding, y2: y, class: 'scatter-median' }));
  }

  points.forEach(point => {
    const circle = svgElement('circle', { cx: point.x, cy: point.y, r: point.radius, class: 'scatter-point' });
    const title = svgElement('title');
    title.textContent = `${point.game.title}：评分 ${point.game.score}，热度 ${compactNumber(point.game.heat)}`;
    circle.append(title);
    svg.append(circle);
  });
  container.setAttribute('role', 'img');
  container.setAttribute('aria-label', `评分与热度散点图，共 ${points.length} 个有效评分样本；评分中位数 ${Number(metrics.scoreMedian || 0).toFixed(1)}，热度中位数 ${compactNumber(metrics.heatMedian)}。`);
  container.append(svg, element('div', { className: 'scatter-axis-note', text: '横轴：评分 0–10 · 纵轴：热度（对数）· 虚线：中位数' }));
}

export function renderCharts(data, metrics) {
  const heat = clear(document.getElementById('heatChart'));
  const scatter = clear(document.getElementById('scatterChart'));
  renderHeatHistogram(heat, data.games);
  renderScatter(scatter, data.games, metrics);
}

export function resizeCharts() {}
export function disposeCharts() {}
