import { validateVisualArtifact } from './model.js';

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
    throw new Error('游戏宇宙数据清单格式无效');
  }
  return manifest;
}

export async function loadUniverse(fetcher = fetch, { nowMs = Date.now() } = {}) {
  const bucket = Math.floor(Number(nowMs) / (5 * 60_000));
  const manifestResponse = await fetcher(`data/v2/manifest.json?v=${Number.isFinite(bucket) ? bucket : 0}`, { cache: 'no-store' });
  if (!manifestResponse.ok) throw new Error(`manifest HTTP ${manifestResponse.status}`);
  const manifest = validateManifest(await manifestResponse.json());
  const visualResponse = await fetcher(`data/v2/${manifest.visual_file}?v=${manifest.visual_sha256.slice(0, 16)}`, { cache: 'force-cache' });
  if (!visualResponse.ok) throw new Error(`visual HTTP ${visualResponse.status}`);
  return { manifest, artifact: validateVisualArtifact(await visualResponse.json()) };
}
