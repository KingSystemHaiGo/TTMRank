export function setReportMode(enabled) {
  document.body.classList.toggle('report-mode', enabled);
  document.getElementById('reportBtn').textContent = enabled ? '返回看板' : '报告模式';
  document.title = enabled ? 'TTMRank 数据分析报告' : '数据洞察 - TTMRank';
  return enabled;
}
export function printReport(){document.body.classList.add('report-mode');requestAnimationFrame(()=>window.print());}
