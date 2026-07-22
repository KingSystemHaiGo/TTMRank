import { eventTimestamp, eventTone } from './model.js';

export const CHANGE_MAP_LANES = Object.freeze([
  { id: 'rank', label: '排名变化', kinds: new Set(['rank_rise', 'rank_fall']) },
  { id: 'appearance', label: '进出榜', kinds: new Set(['entered', 'reentered', 'exited']) },
  { id: 'score', label: '评分变化', kinds: new Set(['score_rise', 'score_fall']) },
  { id: 'coverage', label: '榜单覆盖', kinds: new Set(['coverage_increase', 'coverage_decrease']) },
]);

const RANGE_SECONDS = Object.freeze({ '1h': 3_600, '24h': 86_400, '7d': 604_800 });

function laneFor(kind) {
  return CHANGE_MAP_LANES.findIndex(lane => lane.kinds.has(kind));
}
export function buildChangeMap(events, {
  generatedAt = 0,
  range = '24h',
  width = 960,
  height = 440,
} = {}) {
  const boundedWidth = Math.max(320, Number(width) || 960);
  const boundedHeight = Math.max(300, Number(height) || 440);
  const left = Math.min(112, boundedWidth * 0.24);
  const right = 24;
  const top = 32;
  const bottom = 42;
  const duration = RANGE_SECONDS[range] || RANGE_SECONDS['24h'];
  const end = Number(generatedAt) || 0;
  const start = end - duration;
  const laneHeight = (boundedHeight - top - bottom) / CHANGE_MAP_LANES.length;
  const plotWidth = boundedWidth - left - right;
  const nodes = (Array.isArray(events) ? events : [])
    .filter(event => laneFor(event.kind) >= 0 && eventTimestamp(event) >= start && eventTimestamp(event) <= end)
    .slice(0, 600)
    .map(event => {
      const timestamp = eventTimestamp(event);
      const progress = duration ? (timestamp - start) / duration : 1;
      const lane = laneFor(event.kind);
      const importance = Math.max(0, Math.min(100, Number(event.importance) || 0));
      return {
        id: event.id,
        event,
        lane,
        laneId: CHANGE_MAP_LANES[lane].id,
        x: left + Math.max(0, Math.min(1, progress)) * plotWidth,
        y: top + laneHeight * (lane + 0.5),
        radius: 5 + importance * 0.075,
        tone: eventTone(event.kind),
      };
    });
  return {
    width: boundedWidth,
    height: boundedHeight,
    plot: { left, right, top, bottom, laneHeight },
    start,
    end,
    lanes: CHANGE_MAP_LANES.map((lane, index) => ({
      id: lane.id,
      label: lane.label,
      y: top + laneHeight * (index + 0.5),
    })),
    nodes,
  };
}
