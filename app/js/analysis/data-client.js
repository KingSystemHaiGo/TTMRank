const SHA_PATTERN = /^[a-f0-9]{64}$/i;

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

export async function loadAnalysis(scope = 'all', fetcher = fetch, { nowMs = Date.now(), manifest: knownManifest = null } = {}) {
  let manifest = knownManifest ? validateManifest(knownManifest) : null;
  if (!manifest) {
    const bucket = Math.floor(Number(nowMs) / (5 * 60_000));
    const response = await fetcher(`data/v2/manifest.json?v=${Number.isFinite(bucket) ? bucket : 0}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`manifest HTTP ${response.status}`);
    manifest = validateManifest(await response.json());
  }

  const artifact = analysisArtifact(manifest, scope);
  const response = await fetcher(`data/v2/${artifact.file}?v=${artifact.sha.slice(0, 16)}`, { cache: 'force-cache' });
  if (!response.ok) throw new Error(`analysis HTTP ${response.status}`);
  const data = await response.json();
  if (data?.schema_version !== '2.0') throw new Error(`不支持的数据版本 ${data?.schema_version}`);
  return { manifest, data, scope: artifact.scope };
}

export async function loadQuality(manifest, fetcher = fetch) {
  try {
    const file = validFile(manifest?.quality_file) ? manifest.quality_file : 'quality.json';
    const sha = SHA_PATTERN.test(String(manifest?.quality_sha256 || '')) ? manifest.quality_sha256 : '';
    const suffix = sha ? `?v=${sha.slice(0, 16)}` : '';
    const response = await fetcher(`data/v2/${file}${suffix}`, { cache: sha ? 'force-cache' : 'no-cache' });
    return response.ok ? response.json() : null;
  } catch {
    return null;
  }
}

export async function loadSeries(gameId, historyEndpoint, days = 7) {
  if (!historyEndpoint) return null;
  const to = Math.floor(Date.now() / 1000); const from = to - days * 86400;
  try { const response = await fetch(`${historyEndpoint.replace(/\/$/, '')}/v1/series?game_id=${gameId}&from=${from}&to=${to}`); return response.ok ? response.json() : null; }
  catch { return null; }
}
