export async function loadAnalysis() {
  const manifestResponse = await fetch('data/v2/manifest.json', { cache: 'no-cache' });
  if (!manifestResponse.ok) throw new Error(`manifest HTTP ${manifestResponse.status}`);
  const manifest = await manifestResponse.json();
  if (manifest.schema_version !== '2.0') throw new Error(`不支持的数据版本 ${manifest.schema_version}`);
  const response = await fetch(`data/v2/${manifest.analysis_file}`, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`analysis HTTP ${response.status}`);
  const data = await response.json();
  return { manifest, data };
}

export async function loadQuality() {
  try { const response = await fetch('data/v2/quality.json', { cache: 'no-cache' }); return response.ok ? response.json() : null; }
  catch { return null; }
}

export async function loadSeries(gameId, historyEndpoint, days = 7) {
  if (!historyEndpoint) return null;
  const to = Math.floor(Date.now() / 1000); const from = to - days * 86400;
  try { const response = await fetch(`${historyEndpoint.replace(/\/$/, '')}/v1/series?game_id=${gameId}&from=${from}&to=${to}`); return response.ok ? response.json() : null; }
  catch { return null; }
}
