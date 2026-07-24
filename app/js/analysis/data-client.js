import { readBootstrap } from '../core/bootstrap.js';
import { fetchJsonWithRetry, immutableDataUrl } from '../core/data-fetch.js';

const SHA_PATTERN = /^[a-f0-9]{64}$/i;
const FULL_ANALYSIS_TIMEOUT_MS = 30_000;

function validFile(value) {
  return typeof value === 'string'
    && /^[a-z0-9][a-z0-9._-]*\.json$/i.test(value)
    && !value.includes('..');
}

function validateManifest(manifest) {
  if (manifest?.schema_version !== '2.0'
      || !Number.isSafeInteger(manifest.observed_at)
      || !validFile(manifest.analysis_file)
      || !SHA_PATTERN.test(String(manifest.analysis_sha256 || ''))) {
    throw new Error('分析数据清单格式无效');
  }
  const optionalPairs = [
    ['analysis_made_file', 'analysis_made_sha256'],
    ['quality_file', 'quality_sha256'],
  ];
  optionalPairs.forEach(([fileKey, shaKey]) => {
    if ((manifest[fileKey] !== undefined || manifest[shaKey] !== undefined)
        && (!validFile(manifest[fileKey]) || !SHA_PATTERN.test(String(manifest[shaKey] || '')))) {
      throw new Error('分析数据清单格式无效');
    }
  });
  return manifest;
}

function analysisArtifact(manifest, scope) {
  if (scope === 'made' && manifest.analysis_made_file && manifest.analysis_made_sha256) {
    return { file: manifest.analysis_made_file, sha: manifest.analysis_made_sha256, scope: 'made' };
  }
  return { file: manifest.analysis_file, sha: manifest.analysis_sha256, scope: 'all' };
}

export async function loadAnalysis(scope = 'all', fetcher = fetch, {
  nowMs = Date.now(),
  manifest: knownManifest = null,
  bootstrap = readBootstrap(),
} = {}) {
  const embeddedManifest = bootstrap?.manifest ? validateManifest(bootstrap.manifest) : null;
  const embeddedScope = bootstrap?.analysis_scope || bootstrap?.analysis?.scope;
  if (bootstrap?.analysis?.schema_version === '2.0'
      && ((scope === 'made' && embeddedScope === 'made') || (scope === 'all' && embeddedScope === 'all'))) {
    return { manifest: embeddedManifest, data: bootstrap.analysis, scope: embeddedScope };
  }

  let manifest = knownManifest ? validateManifest(knownManifest) : embeddedManifest;
  if (!manifest) {
    const bucket = Math.floor(Number(nowMs) / (5 * 60_000));
    manifest = validateManifest(await fetchJsonWithRetry(
      `data/v2/manifest.json?v=${Number.isFinite(bucket) ? bucket : 0}`,
      { fetcher, cache: 'no-store' },
    ));
  }

  const artifact = analysisArtifact(manifest, scope);
  const data = await fetchJsonWithRetry(
    immutableDataUrl(`data/v2/${artifact.file}`, artifact.sha),
    {
      fetcher,
      cache: 'force-cache',
      timeoutMs: artifact.scope === 'all' ? FULL_ANALYSIS_TIMEOUT_MS : 10_000,
      retryTimeouts: artifact.scope !== 'all',
    },
  );
  if (data?.schema_version !== '2.0') throw new Error(`不支持的数据版本 ${data?.schema_version}`);
  return { manifest, data, scope: artifact.scope };
}

export async function loadQuality(manifest, fetcher = fetch, { bootstrap = readBootstrap() } = {}) {
  try {
    if (bootstrap?.quality?.schema_version === '2.0') return bootstrap.quality;
    const file = validFile(manifest?.quality_file) ? manifest.quality_file : 'quality.json';
    const sha = SHA_PATTERN.test(String(manifest?.quality_sha256 || '')) ? manifest.quality_sha256 : '';
    return await fetchJsonWithRetry(immutableDataUrl(`data/v2/${file}`, sha), {
      fetcher,
      cache: sha ? 'force-cache' : 'no-cache',
    });
  } catch {
    return null;
  }
}

export async function loadSeries(gameId, historyEndpoint, days = 7) {
  if (!historyEndpoint) return null;
  const to = Math.floor(Date.now() / 1000);
  const from = to - days * 86400;
  try {
    const response = await fetch(`${historyEndpoint.replace(/\/$/, '')}/v1/series?game_id=${gameId}&from=${from}&to=${to}`);
    return response.ok ? response.json() : null;
  } catch {
    return null;
  }
}
