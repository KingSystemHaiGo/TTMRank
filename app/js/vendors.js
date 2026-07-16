import { enrichVendors, filterVendors, ROLE_LABELS, SCALE_LABELS, vendorSummary } from './vendors-model.js';

const byId = id => document.getElementById(id);
let vendors = [];
let filters = { queue: 'all', scale: 'all', role: 'all', query: '' };
let displayLimit = 100;

function element(tag, { className = '', text = '', attrs = {}, children = [] } = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== '') node.textContent = String(text);
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, String(value)));
  children.filter(Boolean).forEach(child => node.append(child));
  return node;
}

function safeSource(value) {
  try { const url = new URL(value); return url.protocol === 'https:' ? url.toString() : ''; } catch { return ''; }
}

function metric(label, value, note, accent = false) {
  return element('article', { className: `vendor-metric${accent ? ' accent' : ''}`, children: [element('span', { text: label }), element('strong', { text: value }), element('small', { text: note })] });
}

function renderMetrics(summary) {
  byId('vendorMetrics').replaceChildren(
    metric('登记名称', summary.total, '当前数据中的规范化账号'),
    metric('已核实', summary.verified, '有公开来源与保守分类', true),
    metric('制造样本待核实', summary.makerPending, '优先补全队列'),
    metric('全部待核实', summary.pending, '不推断团队规模'),
    metric('大型 / 专业', summary.professional, '只作市场参照'),
  );
}

function vendorRow(vendor) {
  const scale = SCALE_LABELS[vendor.scale] || SCALE_LABELS.unverified;
  const role = ROLE_LABELS[vendor.account_role] || ROLE_LABELS.unverified;
  const source = safeSource(vendor.source);
  const classification = element('div', { className: 'vendor-classification', children: [element('span', { className: `vendor-tag ${vendor.scale}`, text: scale }), element('span', { className: 'vendor-tag', text: role })] });
  const coverage = element('div', { className: 'vendor-coverage', children: [element('span', { className: 'vendor-tag', text: `${vendor.game_count} 款游戏` }), vendor.maker_game_count ? element('span', { className: 'vendor-tag maker', text: `${vendor.maker_game_count} 款制造样本` }) : null] });
  const status = vendor.verification === 'verified' ? '已核实' : vendor.queue === 'maker_pending' ? '制造样本 · 待核实' : '待核实';
  const evidenceChildren = [element('span', { text: status }), element('small', { text: vendor.verification === 'verified' ? vendor.note : '没有可靠来源前保持未知，不用于推断个人开发可行性。' })];
  if (source) evidenceChildren.push(element('a', { text: '查看公开来源 ↗', attrs: { href: source, target: '_blank', rel: 'noopener noreferrer' } }));
  return element('article', { className: 'vendor-row', children: [element('div', { className: 'vendor-name', children: [element('strong', { text: vendor.name }), element('small', { text: vendor.maker_game_count ? '出现在 TapTap制造样本中，优先核实实际主体。' : '当前榜单账号名称。' })] }), classification, coverage, element('div', { className: 'vendor-evidence', children: evidenceChildren })] });
}

function render({ focus = null } = {}) {
  const result = filterVendors(vendors, filters);
  const visible = result.slice(0, displayLimit);
  byId('vendorCount').textContent = visible.length < result.length ? `已显示 ${visible.length} / 筛选 ${result.length} / 总计 ${vendors.length}` : `${result.length} / ${vendors.length}`;
  const children = result.length ? visible.map(vendorRow) : [element('div', { className: 'vendor-empty', text: '当前筛选下没有厂商记录' })];
  if (visible.length < result.length) {
    const more = element('button', { className: 'vendor-more', text: `继续加载 ${Math.min(100, result.length - visible.length)} 条`, attrs: { type: 'button' } });
    more.addEventListener('click', () => { displayLimit += 100; render({ focus: 'more' }); });
    children.push(more);
  }
  byId('vendorList').replaceChildren(...children);
  document.querySelectorAll('[data-queue]').forEach(button => {
    const active = button.dataset.queue === filters.queue;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  if (focus === 'more') (byId('vendorList').querySelector('.vendor-more') || byId('vendorCount')).focus({ preventScroll: true });
  if (focus instanceof HTMLElement) focus.focus({ preventScroll: true });
}

function resetAndRender(options) { displayLimit = 100; render(options); }

function bind() {
  document.querySelectorAll('[data-queue]').forEach(button => button.addEventListener('click', () => { filters.queue = button.dataset.queue; resetAndRender({ focus: button }); }));
  byId('vendorQuery').addEventListener('input', event => { filters.query = event.target.value; resetAndRender(); });
  byId('vendorScale').addEventListener('change', event => { filters.scale = event.target.value; resetAndRender(); });
  byId('vendorRole').addEventListener('change', event => { filters.role = event.target.value; resetAndRender(); });
}

async function init() {
  bind();
  try {
    const manifestResponse = await fetch('data/v2/manifest.json', { cache: 'no-cache' });
    if (!manifestResponse.ok) throw new Error(`manifest HTTP ${manifestResponse.status}`);
    const manifest = await manifestResponse.json();
    const vendorResponse = await fetch(`data/v2/${manifest.vendor_file}`, { cache: 'no-cache' });
    if (!vendorResponse.ok) throw new Error('登记数据不可用');
    const registry = await vendorResponse.json();
    vendors = enrichVendors(registry.vendors || []);
    byId('vendorUpdated').textContent = `登记表更新于 ${registry.updated_at || manifest.updated_at}`;
    renderMetrics(vendorSummary(vendors));
    render();
  } catch (error) {
    byId('vendorList').replaceChildren(element('div', { className: 'vendor-empty', text: `厂商登记加载失败：${error.message}` }));
  }
}

init();
