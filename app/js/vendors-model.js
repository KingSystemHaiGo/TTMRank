export const SCALE_LABELS = Object.freeze({ major: '大型厂商', professional: '专业厂商', small_team: '小型团队', solo: '个人 / 单人', unverified: '规模未核实' });
export const ROLE_LABELS = Object.freeze({ developer: '开发', publisher: '发行', operator: '运营', mixed: '开发 / 发行 / 运营', unverified: '账号角色未核实' });

export function canonicalVendorName(value) {
  return String(value ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim() || '未知';
}

export function enrichVendors(vendors, games = []) {
  const usage = new Map();
  games.forEach(game => {
    const name = canonicalVendorName(game.developer_canonical || game.developer);
    if (!usage.has(name)) usage.set(name, { game_count: 0, maker_game_count: 0, heat_total: 0 });
    const value = usage.get(name);
    value.game_count += 1;
    value.maker_game_count += game.is_taptap_made ? 1 : 0;
    value.heat_total += Number(game.heat) || 0;
  });
  return vendors.map(vendor => {
    const canonicalName = canonicalVendorName(vendor.canonical_name || vendor.name);
    const embeddedCoverage = {
      game_count: Number(vendor.game_count) || 0,
      maker_game_count: Number(vendor.maker_game_count) || 0,
      heat_total: Number(vendor.heat_total) || 0,
    };
    const hasEmbeddedCoverage = ['game_count', 'maker_game_count', 'heat_total'].some(key => Object.hasOwn(vendor, key));
    const value = hasEmbeddedCoverage ? embeddedCoverage : usage.get(canonicalName) || embeddedCoverage;
    const queue = vendor.verification === 'verified'
      ? 'verified'
      : value.maker_game_count > 0 ? 'maker_pending' : 'pending';
    const priority = value.maker_game_count * 10000 + value.game_count * 100 + Math.log10(value.heat_total + 1);
    return {
      ...vendor,
      name: canonicalName,
      canonical_name: canonicalName,
      raw_aliases: Array.isArray(vendor.raw_aliases) && vendor.raw_aliases.length ? vendor.raw_aliases : [vendor.name || canonicalName],
      ...value,
      queue,
      priority,
    };
  }).sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name, 'zh-CN'));
}

export function vendorSummary(vendors) {
  return {
    total: vendors.length,
    verified: vendors.filter(vendor => vendor.verification === 'verified').length,
    makerPending: vendors.filter(vendor => vendor.queue === 'maker_pending').length,
    pending: vendors.filter(vendor => vendor.verification !== 'verified').length,
    professional: vendors.filter(vendor => ['major', 'professional'].includes(vendor.scale)).length,
  };
}

export function filterVendors(vendors, filters = {}) {
  const query = canonicalVendorName(filters.query || '').toLocaleLowerCase('zh-CN');
  const hasQuery = Boolean((filters.query || '').trim());
  return vendors.filter(vendor => {
    if (filters.queue && filters.queue !== 'all' && vendor.queue !== filters.queue) return false;
    if (filters.scale && filters.scale !== 'all' && vendor.scale !== filters.scale) return false;
    if (filters.role && filters.role !== 'all' && vendor.account_role !== filters.role) return false;
    const searchable = [vendor.name, vendor.canonical_name, ...(vendor.raw_aliases || []), vendor.note || '']
      .map(canonicalVendorName)
      .join(' ')
      .toLocaleLowerCase('zh-CN');
    if (hasQuery && !searchable.includes(query)) return false;
    return true;
  });
}
