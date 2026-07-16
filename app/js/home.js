const compact = value => new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 }).format(value || 0);

async function init() {
  try {
    const manifestResponse = await fetch('data/v2/manifest.json', { cache: 'no-cache' });
    if (!manifestResponse.ok) throw new Error('manifest unavailable');
    const manifest = await manifestResponse.json();
    const analysisResponse = await fetch(`data/v2/${manifest.analysis_file}`, { cache: 'no-cache' });
    if (!analysisResponse.ok) throw new Error('analysis unavailable');
    const analysis = await analysisResponse.json();
    const makerCount = analysis.games.filter(game => game.is_taptap_made).length;
    document.getElementById('makerCount').textContent = compact(makerCount);
    document.getElementById('gameCount').textContent = compact(manifest.game_count);
    document.getElementById('appearanceCount').textContent = compact(manifest.appearance_count);
    document.getElementById('freshness').textContent = `数据更新于 ${manifest.updated_at}`;
    document.getElementById('snapshotTime').textContent = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Shanghai' }).format(new Date(manifest.observed_at * 1000));
  } catch {
    document.getElementById('freshness').textContent = '数据快照暂时不可用';
  }
}

init();
