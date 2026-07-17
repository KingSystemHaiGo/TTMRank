export function describeReport(filters, count, generatedAt) {
  const parts = [
    filters.scope === 'made' ? 'TapTap制造' : '全部游戏',
    filters.platform === 'all' ? '全部平台' : filters.platform === 'ios' ? 'iOS' : 'Android',
  ];
  const released = /^(\d+)(h|d)$/.exec(filters.released || '');
  if (released) parts.push(`近${released[1]}${released[2] === 'd' ? '天' : '小时'}`);
  if (filters.growth24hMin !== null && filters.growth24hMin !== undefined) parts.push(`近24小时每小时增长 ≥ ${filters.growth24hMin}`);
  if (filters.growth24hMax !== null && filters.growth24hMax !== undefined) parts.push(`近24小时每小时增长 ≤ ${filters.growth24hMax}`);
  parts.push(filters.baseline === 'fixed' ? '固定基准' : '动态基准', `样本 ${count}`, `生成 ${generatedAt}`);
  return parts.join(' · ');
}

export function setReportMode(enabled) {
  document.body.classList.toggle('report-mode', enabled);
  document.getElementById('reportBtn').textContent = enabled ? '返回看板' : '报告模式';
  document.title = enabled ? 'TTMRank 游戏分析报告' : '游戏分析 · TTMRank';
  return enabled;
}
export function printReport(){document.body.classList.add('report-mode');requestAnimationFrame(()=>window.print());}
