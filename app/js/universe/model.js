const MAX_VISUAL_GAMES = 180;

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function validGame(game) {
  return game && typeof game === 'object'
    && Number.isSafeInteger(game.id)
    && game.id > 0
    && typeof game.title === 'string'
    && game.title.length > 0
    && typeof game.cluster === 'string'
    && game.cluster.length > 0
    && Array.isArray(game.tags)
    && game.tags.every(tag => typeof tag === 'string')
    && (game.heat === null || finite(game.heat) !== null)
    && (game.score === null || finite(game.score) !== null)
    && Number.isSafeInteger(Number(game.chart_coverage))
    && Number.isSafeInteger(Number(game.platform_coverage));
}

export function validateVisualArtifact(value) {
  if (!value || typeof value !== 'object'
    || value.schema_version !== '1.0'
    || !Number.isSafeInteger(value.observed_at)
    || !Array.isArray(value.clusters)
    || !value.clusters.every(cluster => typeof cluster === 'string' && cluster.length > 0)
    || !Array.isArray(value.games)
    || value.games.length > MAX_VISUAL_GAMES
    || !value.games.every(validGame)) {
    throw new Error('视觉数据格式无效');
  }
  return value;
}

function normalizedLog(value, minimum, maximum) {
  const current = Math.log10(Math.max(0, finite(value) || 0) + 1);
  const low = Math.log10(Math.max(0, minimum) + 1);
  const high = Math.log10(Math.max(0, maximum) + 1);
  return high === low ? 0.5 : Math.max(0, Math.min(1, (current - low) / (high - low)));
}

export function buildUniverseLayout(input) {
  const artifact = validateVisualArtifact(input);
  const games = artifact.games;
  const heats = games.map(game => Math.max(0, finite(game.heat) || 0));
  const minimumHeat = heats.length ? Math.min(...heats) : 0;
  const maximumHeat = heats.length ? Math.max(...heats) : 0;
  const declaredClusters = artifact.clusters.length ? artifact.clusters : ['其他'];
  const usedClusters = new Set(games.map(game => declaredClusters.includes(game.cluster) ? game.cluster : '其他'));
  const clusters = declaredClusters.filter(cluster => usedClusters.has(cluster));
  if (usedClusters.has('其他') && !clusters.includes('其他')) clusters.push('其他');
  if (!clusters.length) clusters.push('其他');
  const clusterIndex = new Map(clusters.map((cluster, index) => [cluster, index]));
  const nodes = games.map(game => {
    const heatLevel = normalizedLog(game.heat, minimumHeat, maximumHeat);
    const cluster = clusterIndex.has(game.cluster) ? game.cluster : '其他';
    const score = finite(game.score);
    return {
      ...game,
      cluster,
      lane: clusterIndex.get(cluster) ?? 0,
      plotX: 0.025 + heatLevel * 0.95,
      plotY: 0,
      scoreBand: score === null ? 'unrated' : score >= 9 ? 'excellent' : score >= 8 ? 'good' : 'standard',
      heatLevel,
    };
  });

  for (let lane = 0; lane < clusters.length; lane += 1) {
    const laneNodes = nodes
      .filter(node => node.lane === lane)
      .sort((left, right) => left.plotX - right.plotX || left.id - right.id);
    const slotEnds = [-1, -1];
    const slotNodes = [[], []];
    laneNodes.forEach((node, index) => {
      let slot = slotEnds.findIndex(end => node.plotX - end >= 0.046);
      if (slot < 0) slot = slotEnds.indexOf(Math.min(...slotEnds));
      node.displayX = Math.max(node.plotX, slotEnds[slot] + 0.046);
      slotEnds[slot] = node.displayX;
      node.laneSlot = slot;
      slotNodes[slot].push(node);
      node.plotY = (lane + (slot === 0 ? 0.28 : 0.72)) / clusters.length;
      node.featured = index === laneNodes.length - 1;
    });
    slotNodes.forEach(rows => {
      const overflow = Math.max(0, (rows.at(-1)?.displayX || 0) - 0.975);
      rows.forEach(node => { node.displayX = Math.max(0.025, node.displayX - overflow); });
    });
  }
  return { clusters, nodes };
}

export function selectMapNodes(nodes, {
  focused = false,
  maxPerLane = 5,
  maxFocused = 12,
  includeId = 0,
} = {}) {
  const cap = Math.max(1, focused ? maxFocused : maxPerLane);
  const lanes = new Map();
  for (const node of nodes || []) {
    if (!lanes.has(node.lane)) lanes.set(node.lane, []);
    lanes.get(node.lane).push(node);
  }
  const selected = [];
  [...lanes.entries()].sort(([left], [right]) => left - right).forEach(([_lane, laneNodes]) => {
    laneNodes.sort((left, right) => left.plotX - right.plotX || left.id - right.id);
    if (laneNodes.length <= cap) {
      selected.push(...laneNodes);
      return;
    }
    const indices = new Set();
    for (let index = 0; index < cap; index += 1) {
      indices.add(Math.round((index * (laneNodes.length - 1)) / Math.max(1, cap - 1)));
    }
    const representatives = [...indices].map(index => laneNodes[index]);
    const included = laneNodes.find(node => node.id === Number(includeId));
    if (included && !representatives.some(node => node.id === included.id)) {
      let nearestIndex = 0;
      for (let index = 1; index < representatives.length; index += 1) {
        if (Math.abs(representatives[index].plotX - included.plotX)
          < Math.abs(representatives[nearestIndex].plotX - included.plotX)) nearestIndex = index;
      }
      representatives[nearestIndex] = included;
      representatives.sort((left, right) => left.plotX - right.plotX || left.id - right.id);
    }
    selected.push(...representatives);
  });
  return selected;
}

export function renderMode({
  requested = 'static',
  webgl = false,
  saveData = false,
  hardwareConcurrency = 4,
} = {}) {
  if (requested !== 'webgl') return 'static';
  if (!webgl || saveData || Number(hardwareConcurrency) <= 2) return 'static';
  return 'webgl';
}
