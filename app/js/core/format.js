export function compactNumber(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  const number = Number(value);
  if (Math.abs(number) >= 100_000_000) return `${(number / 100_000_000).toFixed(number >= 1_000_000_000 ? 0 : 1)}亿`;
  if (Math.abs(number) >= 10_000) return `${(number / 10_000).toFixed(number >= 100_000 ? 1 : 2)}万`;
  return Math.round(number).toLocaleString('zh-CN');
}
export const decimal = (value, digits = 1) => value === null || value === undefined ? '—' : Number(value).toFixed(digits);
export function dateTime(timestamp) { return timestamp ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false }).format(new Date(timestamp * 1000)) : '—'; }
export function age(hours) { if (hours === null || hours === undefined) return '未知'; if (hours < 24) return `${hours.toFixed(1)} 小时`; if (hours < 24 * 60) return `${(hours / 24).toFixed(1)} 天`; return `${(hours / 24 / 30).toFixed(1)} 月`; }
export const platformName = value => ({android:'Android',ios:'iOS'}[value] || value);
export const chartName = value => ({hot:'热门榜',sell:'热卖榜',reserve:'预约榜',new:'新品榜',action:'动作榜',strategy:'策略榜',shooter:'射击榜',roguelike:'Roguelike',casual:'休闲榜',independent:'独立榜',acgn:'二次元榜',otome:'乙女榜',music:'音乐榜',idle:'放置榜'}[value] || value);
