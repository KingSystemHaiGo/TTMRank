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

function hashUnit(value) {
  let hash = 2166136261;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4_294_967_295;
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
  const clusters = artifact.clusters.length ? artifact.clusters : ['其他'];
  const clusterIndex = new Map(clusters.map((cluster, index) => [cluster, index]));
  const sector = (Math.PI * 2) / clusters.length;
  const nodes = games.map(game => {
    const heatLevel = normalizedLog(game.heat, minimumHeat, maximumHeat);
    const cluster = clusterIndex.has(game.cluster) ? game.cluster : '其他';
    const index = clusterIndex.get(cluster) ?? 0;
    const jitter = (hashUnit(game.id) - 0.5) * sector * 0.62;
    const angle = index * sector + jitter - Math.PI / 2;
    // Hotter games live nearer the core; cooler games form the outer discovery ring.
    const radialDistance = 5.2 + (1 - heatLevel) * 11.8 + (hashUnit(`${game.id}:radius`) - 0.5) * 1.4;
    const score = finite(game.score);
    const y = score === null ? -0.7 : Math.max(-2.6, Math.min(3.2, (score - 7.5) * 1.55));
    return {
      ...game,
      cluster,
      angle,
      radialDistance,
      x: Math.cos(angle) * radialDistance,
      y,
      z: Math.sin(angle) * radialDistance,
      size: 0.24 + heatLevel * 0.58,
      heatLevel,
    };
  });
  return { clusters, nodes };
}

export function renderMode({
  requested = 'auto',
  webgl = false,
  saveData = false,
  hardwareConcurrency = 4,
} = {}) {
  if (requested === 'static') return 'static';
  if (!webgl || saveData || Number(hardwareConcurrency) <= 2) return 'static';
  return 'webgl';
}
