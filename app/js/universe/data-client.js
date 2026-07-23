import { validateVisualArtifact } from './model.js?v=2';
import { readBootstrap } from '../core/bootstrap.js';
import { fetchJsonWithRetry, immutableDataUrl } from '../core/data-fetch.js';

function validFile(value) {
  return typeof value === 'string'
    && /^[a-z0-9][a-z0-9._-]*\.json$/i.test(value)
    && !value.includes('..');
}
function validateManifest(manifest) {
  if (manifest?.schema_version !== '2.0'
    || !Number.isSafeInteger(manifest.observed_at)
    || !validFile(manifest.visual_file)
    || !/^[a-f0-9]{64}$/i.test(String(manifest.visual_sha256 || ''))) {
    throw new Error('游戏地图数据清单格式无效');
  }
  return manifest;
}

export async function loadUniverse(fetcher = fetch, { nowMs = Date.now(), bootstrap = readBootstrap() } = {}) {
  if (bootstrap?.manifest && bootstrap?.visual) {
    return {
      manifest: validateManifest(bootstrap.manifest),
      artifact: validateVisualArtifact(bootstrap.visual),
    };
  }
  const bucket = Math.floor(Number(nowMs) / (5 * 60_000));
  const manifest = validateManifest(await fetchJsonWithRetry(
    `data/v2/manifest.json?v=${Number.isFinite(bucket) ? bucket : 0}`,
    { fetcher, cache: 'no-store' },
  ));
  const artifact = validateVisualArtifact(await fetchJsonWithRetry(
    immutableDataUrl(`data/v2/${manifest.visual_file}`, manifest.visual_sha256),
    { fetcher, cache: 'force-cache' },
  ));
  return { manifest, artifact };
}
