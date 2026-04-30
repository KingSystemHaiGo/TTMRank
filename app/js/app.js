const RANK_TYPES = [
  {key:'hot',name:'热门榜'},{key:'sell',name:'热卖榜'},{key:'reserve',name:'预约榜'},{key:'new',name:'新品榜'},
  {key:'action',name:'动作榜'},{key:'strategy',name:'策略榜'},{key:'shooter',name:'射击榜'},{key:'roguelike',name:'Roguelike'},
  {key:'casual',name:'休闲榜'},{key:'independent',name:'独立榜'},{key:'acgn',name:'二次元榜'},{key:'otome',name:'乙女榜'},
  {key:'music',name:'音乐榜'},{key:'idle',name:'放置榜'},
];
const PLATFORMS = [{key:'android',name:'Android'},{key:'ios',name:'iOS'}];
const SYSTEM_PROMPT = `你是游戏市场数据分析师。基于提供的榜单全量数据，输出以创作机会、热度评价、排名分析为核心的专业简报。不评价平台本身，不讨论 AI 工具。\n\n分析框架（必须覆盖全部维度）：\n\n1. 排名格局分析（200字）\n   - 当前榜单排名分布特征：头部固化还是流动频繁？Top10/Top20/Top50 的集中度变化。\n   - 新品冲榜速度与老品守榜能力对比，判断市场进入窗口期宽窄。\n   - 排名与评分、热度的相关性：高排名由高热驱动还是口碑驱动？\n\n2. 热度评价（200字）\n   - 全榜热度分布：是否存在"热度断层"（前几名垄断流量，中腰部断层）？\n   - 高热度游戏的共性特征（品类、题材、玩法机制、上线时长）。\n   - 低热度高评分游戏的潜在价值：是否被低估的细分机会？\n   - 热度增速异常值：近期热度飙升或下跌的游戏及其驱动因素。\n\n3. 重点游戏拆解（200字，3-5款）\n   - 点名具体排名、评分、热度，分析其市场表现的核心驱动力（玩法、题材、运营事件）。\n   - 识别异常值："高口碑低流量"（获客难）与"高流量低口碑"（买量或 IP 透支）。\n   - 判断生命周期阶段（导入期/成长期/成熟期/衰退期）与后续走势预判。\n\n4. 创作机会（250字）\n   - 竞争不饱和赛道：哪些品类头部集中度低、新进入者存活率高？\n   - 跨界融合方向：未被尝试的品类组合（如放置+叙事、Roguelike+社交）。\n   - 用户痛点映射为产品机会：评分低但热度高的品类说明需求存在但供给质量不足。\n   - 题材空白：基于 tags 分布找出未被覆盖的题材与风格组合。\n   - 差异化切入点：避开头部红海、切入细分需求的具体策略。\n\n5. 风险与壁垒（150字）\n   - 同质化红海：哪些品类已有过多相似产品，新进入者难以突围？\n   - 头部护城河：IP、社交、玩法专利等壁垒对新团队的挑战。\n   - 评分通胀风险：某品类评分普遍虚高可能暗示用户期望落差。\n\n输出要求：\n- 中文，专业术语准确，杜绝"内容丰富""体验优秀"等空洞形容词\n- 必须有具体数据支撑观点（如：Top3平均评分8.9，二次元品类占比35%，热度断层系数）\n- 总字数 900-1200 字\n- 不要解释分析过程，直接输出结论`;

let data = null, activePlat = 'android', activeKey = 'hot', charts = {}, cfg = JSON.parse(localStorage.getItem('ttm_llm')||'{}'), currentItems = [];

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme === 'dark' ? 'dark' : 'light');
}
function toggleTheme() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const next = isDark ? 'light' : 'dark';
  applyTheme(next);
  localStorage.setItem('ttm_theme', next);
}
(function initTheme() {
  const saved = localStorage.getItem('ttm_theme');
  applyTheme(saved === 'dark' ? 'dark' : 'light');
})();

const PLAT_ICON = {
  android: '<svg class="gplat" viewBox="0 0 24 24" fill="currentColor"><path d="M17.6 9.48l1.84-3.18c.16-.31.04-.69-.26-.85-.29-.15-.65-.06-.83.22l-1.88 3.24c-1.4-.59-2.96-.92-4.47-.92s-3.07.33-4.47.92L5.81 5.67c-.19-.29-.54-.38-.83-.22-.31.16-.43.54-.26.85L6.56 9.48C3.91 11.25 2.16 14.21 2 17.5h20c-.16-3.29-1.91-6.25-4.4-8.02zM7 15.25c-.69 0-1.25-.56-1.25-1.25s.56-1.25 1.25-1.25 1.25.56 1.25 1.25-.56 1.25-1.25 1.25zm10 0c-.69 0-1.25-.56-1.25-1.25s.56-1.25 1.25-1.25 1.25.56 1.25 1.25-.56 1.25-1.25 1.25z"/></svg>',
  ios: '<svg class="gplat" viewBox="0 0 24 24" fill="currentColor"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.21-1.96 1.07-3.11-1.05.05-2.31.72-3.06 1.64-.68.83-1.27 2.16-1.11 3.24 1.19.09 2.38-.62 3.1-1.77z"/></svg>',
  pc: '<svg class="gplat" viewBox="0 0 24 24" fill="currentColor"><path d="M20 18c1.1 0 1.99-.9 1.99-2L22 5c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v11c0 1.1.9 2 2 2H0c0 1.1.9 2 2 2h20c1.1 0 2-.9 2-2h-4zM4 5h16v11H4V5z"/></svg>',
};

function thumbUrl(url) {
  return url || '';
}

function showSkeleton() {
  document.getElementById('main').innerHTML =
    '<div class="dash">'+
      '<div class="skeleton skeleton-dash"></div>'+
      '<div class="skeleton skeleton-dash"></div>'+
      '<div class="skeleton skeleton-dash"></div>'+
      '<div class="skeleton skeleton-dash"></div>'+
    '</div>'+
    '<div class="skeleton skeleton-card"></div>'+
    '<div class="skeleton skeleton-card"></div>'+
    '<div class="skeleton skeleton-card"></div>'+
    '<div class="skeleton skeleton-card"></div>'+
    '<div class="skeleton skeleton-card"></div>'+
    '<div class="skeleton skeleton-card"></div>';
}

async function init() {
  showSkeleton();
  try {
    const rankRes = await fetch('data/rankings.json');
    if (!rankRes.ok) throw new Error('HTTP '+rankRes.status);
    data = await rankRes.json();
    document.getElementById('updateTime').textContent = '更新: ' + data.updated_at;
    renderPlatBar();
    renderTabs();
    switchTab(activeKey);
  } catch(e) {
    document.getElementById('main').innerHTML = '<div class="err">数据加载失败: '+e.message+'<br><small>请先运行 python fetcher.py</small></div>';
  }
}

function renderPlatBar() {
  document.getElementById('platBar').innerHTML = PLATFORMS.map(p =>
    '<button class="plat-btn '+(p.key===activePlat?'active':'')+'" onclick="switchPlat(\''+p.key+'\')">'+p.name+'</button>'
  ).join('');
}

function switchPlat(key) {
  activePlat = key;
  renderPlatBar();
  renderTabs();
  switchTab(activeKey);
}

function renderTabs() {
  const platData = data?.platforms?.[activePlat] || {};
  document.getElementById('tabs').innerHTML = RANK_TYPES.map(t => {
    const cnt = platData[t.key]?.items?.length || 0;
    return '<button class="tab '+(t.key===activeKey?'active':'')+'" data-key="'+t.key+'" onclick="switchTab(\''+t.key+'\')">'+t.name+' '+cnt+'</button>';
  }).join('');
}

function switchTab(key) {
  activeKey = key;
  document.querySelectorAll('.tab').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-key') === key);
  });
  const r = data?.platforms?.[activePlat]?.[key];
  if (!r) { document.getElementById('main').innerHTML='<div class="err">该榜单暂无数据</div>'; return; }
  currentItems = r.items || [];

  const itemsHtml = r.items.map(item => {
    const rc = item.rank<=3?'top'+item.rank:'';
    const tags = item.tags.map(t=>'<span class="gtag">'+t+'</span>').join('');
    const hint = item.hints[0]?'<span class="ghint">'+item.hints[0]+'</span>':'';
    const plats = (item.platforms||[]).map(p=>PLAT_ICON[p]||'').join('');
    return '<div class="game-card" onclick="openGameModal('+item.id+')">'+
      '<div class="rank '+rc+'">'+item.rank+'</div>'+
      '<img class="gicon lazy-img" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" data-src="'+thumbUrl(item.icon)+'" alt="" onerror="this.src=\'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2248%22 height=%2248%22%3E%3Crect width=%2248%22 height=%2248%22 fill=%22%23e8e8e8%22 rx=%2210%22/%3E%3C/svg%3E\'">'+
      '<div class="info">'+
        '<div class="line1"><span class="gtitle">'+item.title+'</span>'+hint+'</div>'+
        '<div class="line2"><span class="gscore">'+item.score+'</span>'+tags+'<span class="gplat">'+plats+'</span></div>'+
      '</div>'+
      '<div class="gcount"><div class="gcount-v">'+item.count_str+'</div><div class="gcount-l">'+item.count_label+'</div></div>'+
    '</div>';
  }).join('');

  document.getElementById('main').innerHTML =
    '<div class="dash">'+
      '<div class="dash-box"><div class="dash-title">游戏类型分布</div><div class="dash-chart" id="c-tag"></div></div>'+
      '<div class="dash-box"><div class="dash-title">平台分布</div><div class="dash-chart" id="c-plat"></div></div>'+
      '<div class="dash-box"><div class="dash-title">评分分布</div><div class="dash-chart" id="c-score"></div></div>'+
      '<div class="dash-box"><div class="dash-title">热度区间分布</div><div class="dash-chart" id="c-heat"></div></div>'+
    '</div>'+
    '<div class="ai-bar"><button class="btn-ai" id="btnAi" onclick="doSummary()">'+
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg> AI 总结'+
    '</button></div>'+
    '<div class="ai-result" id="aiResult"></div>'+
    '<div class="search-bar"><input type="text" id="searchInput" placeholder="搜索游戏名称、标签..." oninput="debounceFilter()"></div>'+
    '<div class="search-count" id="searchCount"></div>'+
    '<div class="game-list" id="gameList">'+itemsHtml+'</div>';

  requestAnimationFrame(() => { renderDashboard(r.items); filterGames(); setupLazyLoad(); });
}

function renderDashboard(items) {
  Object.values(charts).forEach(c => c && c.dispose());
  charts = {};
  if (!items.length) return;

  const tc = {};
  items.forEach(it => (it.tags||[]).forEach(t => tc[t]=(tc[t]||0)+1));
  const td = Object.entries(tc).sort((a,b)=>b[1]-a[1]).slice(0,10);
  charts.tag = echarts.init(document.getElementById('c-tag'));
  charts.tag.setOption({tooltip:{trigger:'item',formatter:'{b}: {c} ({d}%)'}, series:[{type:'pie',radius:['30%','60%'],center:['50%','50%'],itemStyle:{borderRadius:6,borderColor:'#fff',borderWidth:2},label:{fontSize:10,formatter:'{b}'},labelLine:{length:6,length2:4},data:td.map(([n,v])=>({name:n,value:v}))}]});

  const pc = {};
  items.forEach(it => {
    const key = (it.platforms||[]).filter(Boolean).sort().join('/');
    if (key) pc[key] = (pc[key]||0) + 1;
  });
  const pm = {android:'Android',ios:'iOS',pc:'PC'};
  charts.plat = echarts.init(document.getElementById('c-plat'));
  charts.plat.setOption({tooltip:{trigger:'item'}, series:[{type:'pie',radius:['30%','60%'],center:['50%','50%'],itemStyle:{borderRadius:6,borderColor:'#fff',borderWidth:2},label:{fontSize:10,formatter:'{b}\n{c}'},labelLine:{length:6,length2:4},data:Object.entries(pc).map(([k,v])=>({name:k.split('/').map(p=>pm[p]||p).join('/'),value:v}))}]});

  const sb = {'9+':0,'8~9':0,'7~8':0,'<7':0,'暂无':0};
  items.forEach(it=>{const s=parseFloat(it.score)||0; if(s===0||it.score==='-') sb['暂无']++; else if(s>=9) sb['9+']++; else if(s>=8) sb['8~9']++; else if(s>=7) sb['7~8']++; else sb['<7']++;});
  charts.score = echarts.init(document.getElementById('c-score'));
  charts.score.setOption({tooltip:{trigger:'item'}, series:[{type:'pie',radius:['30%','60%'],center:['50%','50%'],itemStyle:{borderRadius:6,borderColor:'#fff',borderWidth:2},label:{fontSize:10,formatter:'{b}\n{c}'},labelLine:{length:6,length2:4},data:Object.entries(sb).filter(([,v])=>v>0).map(([k,v])=>({name:k,value:v}))}]});

  const mx = Math.max(...items.map(it=>it.count||0));
  const hb = mx>=10000?{'<1万':0,'1~10万':0,'10~100万':0,'100万+':0}:{'<1000':0,'1k~5k':0,'5k~1万':0,'1万+':0};
  items.forEach(it=>{const c=it.count||0; if(mx>=10000){if(c<10000) hb['<1万']++; else if(c<100000) hb['1~10万']++; else if(c<1000000) hb['10~100万']++; else hb['100万+']++;} else {if(c<1000) hb['<1000']++; else if(c<5000) hb['1k~5k']++; else if(c<10000) hb['5k~1万']++; else hb['1万+']++;}});
  charts.heat = echarts.init(document.getElementById('c-heat'));
  charts.heat.setOption({tooltip:{trigger:'item'}, series:[{type:'pie',radius:['30%','60%'],center:['50%','50%'],itemStyle:{borderRadius:6,borderColor:'#fff',borderWidth:2},label:{fontSize:10,formatter:'{b}\n{c}'},labelLine:{length:6,length2:4},data:Object.entries(hb).filter(([,v])=>v>0).map(([k,v])=>({name:k,value:v}))}]});
}

function mdToHtml(text) {
  if (!text) return '';
  let html = text.replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
  html = html.replace(/\*\*([^\*]+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(^|\s)\*([^\*]+?)\*(\s|$)/g, '$1<em>$2</em>$3');
  const lines = html.split('\n');
  let out = [], inList = false, listType = null, para = [];
  function flushPara() {
    if (para.length) { out.push('<p style="margin:6px 0;">' + para.join('<br>') + '</p>'); para = []; }
  }
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    if (!line) { flushPara(); continue; }
    if (/^(#{1,3})\s+(.+)/.test(line)) {
      flushPara(); if (inList) { out.push(listType==='ul'?'</ul>':'</ol>'); inList = false; listType = null; }
      const m = line.match(/^(#{1,3})\s+(.+)/);
      const h = m[1].length + 2;
      out.push(`<h${h} style="margin:10px 0 6px;">${m[2]}</h${h}>`);
    } else if (/^[-*]\s+(.+)/.test(line)) {
      flushPara(); if (!inList || listType !== 'ul') { if (inList) out.push('</ol>'); out.push('<ul style="margin:6px 0;padding-left:20px;">'); inList = true; listType = 'ul'; }
      out.push('<li>' + line.replace(/^[-*]\s+(.+)/, '$1') + '</li>');
    } else if (/^\d+\.\s+(.+)/.test(line)) {
      flushPara(); if (!inList || listType !== 'ol') { if (inList) out.push('</ul>'); out.push('<ol style="margin:6px 0;padding-left:20px;">'); inList = true; listType = 'ol'; }
      out.push('<li>' + line.replace(/^\d+\.\s+(.+)/, '$1') + '</li>');
    } else {
      if (inList) { out.push(listType==='ul'?'</ul>':'</ol>'); inList = false; listType = null; }
      para.push(line);
    }
  }
  flushPara(); if (inList) out.push(listType==='ul'?'</ul>':'</ol>');
  return out.join('');
}

async function doSummary() {
  const btn = document.getElementById('btnAi');
  const box = document.getElementById('aiResult');
  if (!cfg.url || !cfg.key || !cfg.model) { alert('请先配置LLM（点击右上角齿轮）'); openModal(); return; }
  if (!data || !data.platforms || !data.platforms[activePlat] || !data.platforms[activePlat][activeKey]) {
    alert('当前榜单数据未加载，请刷新页面'); return;
  }

  const chartData = data.platforms[activePlat][activeKey];
  if (!chartData || !chartData.items || !chartData.items.length) { alert('当前榜单暂无数据'); return; }
  const top = chartData.items;
  const lines = top.map((it,i) => `${i+1}. ${it.title} | 排名${it.rank} | 评分${it.score} | 热度${it.count_str} | 类型:${(it.tags||[]).join(',')}`).join('\n');
  const prompt = `请对以下 TapTap「${chartData.title}」当前榜单全部 ${top.length} 款游戏进行深度分析：\n\n${lines}\n\n请按系统设定框架输出分析简报。`;

  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> 分析中...';
  box.classList.add('show');
  box.innerHTML = '<div class="ai-title">AI 分析中...</div>';

  let debugInfo = {url: cfg.url, status: ''};

  async function callLlm(apiUrl) {
    const body = {model:cfg.model, messages:[{role:'system',content:SYSTEM_PROMPT},{role:'user',content:prompt}], temperature:0.6, max_tokens:3000, stream:false};
    return fetch(apiUrl, {method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+cfg.key}, body: JSON.stringify(body)});
  }

  try {
    let res = await callLlm(cfg.url);
    debugInfo.status = res.status + ' ' + res.statusText;

    let j;
    try { j = await res.json(); } catch(e) { throw new Error('响应解析失败: ' + e.message); }

    if (!res.ok) {
      const errMsg = j.error?.message || j.error || j.message || ('HTTP ' + res.status);
      throw new Error(errMsg);
    }
    if (j.error) {
      throw new Error(j.error?.message || j.error);
    }
    const text = j.choices?.[0]?.message?.content || '无返回内容';
    const truncated = text.length > 100 && !/[。．.!?！？」』】\)\]\}…]\s*$/.test(text);
    const warn = truncated ? '<div style="color:#e53935;font-size:12px;margin-bottom:8px;">⚠️ 内容可能因长度限制被截断，可尝试使用更大上下文的模型。</div>' : '';
    box.innerHTML = '<div class="ai-title">' + chartData.title + ' - AI 总结</div>' + warn + mdToHtml(text);
  } catch(e) {
    const hint = '提示: 若配置的是 DeepSeek，URL 请填写 https://api.deepseek.com/chat/completions，模型填写 deepseek-chat';
    const stack = e.stack ? e.stack.replace(/\n/g, '<br>') : '';
    box.innerHTML = '<div class="ai-title" style="color:#e53935">分析失败</div>' + (e.message || e) +
      '<div class="ai-debug">请求URL: ' + debugInfo.url + '<br>状态码: ' + debugInfo.status + '<br>' + hint + '</div>' +
      (stack ? '<div class="ai-debug" style="margin-top:6px">' + stack + '</div>' : '');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg> AI 总结';
  }
}

async function doRefresh() {
  const btn = document.getElementById('btnRefresh');
  btn.disabled = true;
  const orig = btn.innerHTML;
  btn.innerHTML = '<span class="spinner" style="border-color:rgba(0,0,0,0.2);border-top-color:#14b9c8"></span>';
  try {
    const res = await fetch('/refresh');
    let j;
    const txt = await res.text();
    try { j = JSON.parse(txt); } catch(e) { j = {raw: txt.slice(0,200)}; }
    if (!res.ok) {
      let hint = j.error || j.raw || '';
      if (res.status === 404) hint = '请确保通过 python server.py 启动服务器，不要直接打开 HTML 文件';
      alert('刷新失败 (HTTP ' + res.status + '): ' + hint);
      return;
    }
    if (j.success) { await init(); }
    else { alert('刷新失败: ' + (j.error || '未知错误')); }
  } catch(e) {
    let msg = e.message;
    if (location.protocol === 'file:') msg = '不能直接打开 HTML 文件，请先运行 python server.py 启动服务器';
    alert('刷新请求失败: ' + msg);
  } finally {
    btn.disabled = false;
    btn.innerHTML = orig;
  }
}
document.getElementById('btnRefresh').onclick = doRefresh;

function openModal() {
  document.getElementById('iUrl').value = cfg.url||'';
  document.getElementById('iKey').value = cfg.key||'';
  document.getElementById('iModel').value = cfg.model||'';
  document.getElementById('modalBg').classList.add('show');
}
function closeModal() { document.getElementById('modalBg').classList.remove('show'); }
function saveModal() {
  cfg = { url: document.getElementById('iUrl').value.trim(), key: document.getElementById('iKey').value.trim(), model: document.getElementById('iModel').value.trim() };
  localStorage.setItem('ttm_llm', JSON.stringify(cfg));
  closeModal();
}
document.getElementById('btnSet').onclick = openModal;
document.getElementById('btnCancel').onclick = closeModal;
document.getElementById('btnSave').onclick = saveModal;
document.getElementById('modalBg').onclick = e => { if(e.target===document.getElementById('modalBg')) closeModal(); };
document.getElementById('btnTheme').onclick = toggleTheme;

let _lazyObserver = null;
let _filterTimer = null;
function debounceFilter() {
  if (_filterTimer) clearTimeout(_filterTimer);
  _filterTimer = setTimeout(filterGames, 200);
}
function setupLazyLoad() {
  if (_lazyObserver) _lazyObserver.disconnect();
  const imgs = Array.from(document.querySelectorAll('.lazy-img'));
  imgs.slice(0, 8).forEach(img => {
    if (img.dataset.src) { img.src = img.dataset.src; img.removeAttribute('data-src'); }
  });
  _lazyObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const img = entry.target;
        if (img.dataset.src) {
          img.src = img.dataset.src;
          img.removeAttribute('data-src');
        }
        _lazyObserver.unobserve(img);
      }
    });
  }, { rootMargin: '50px' });
  imgs.slice(8).forEach(img => _lazyObserver.observe(img));
}

function filterGames() {
  const q = document.getElementById('searchInput')?.value.trim().toLowerCase() || '';
  const list = document.getElementById('gameList');
  const countEl = document.getElementById('searchCount');
  if (!list) return;
  let filtered = currentItems;
  if (q) {
    filtered = currentItems.filter(it => {
      const inTitle = (it.title||'').toLowerCase().includes(q);
      const inTags = (it.tags||[]).some(t => t.toLowerCase().includes(q));
      const inDev = (it.developer||'').toLowerCase().includes(q);
      return inTitle || inTags || inDev;
    });
  }
  if (countEl) countEl.textContent = q ? '找到 ' + filtered.length + ' 款游戏' : '共 ' + filtered.length + ' 款';
  const html = filtered.map(item => {
    const rc = item.rank<=3?'top'+item.rank:'';
    const tags = item.tags.map(t => '<span class="gtag">'+t+'</span>').join('');
    const hint = item.hints[0]?'<span class="ghint">'+item.hints[0]+'</span>':'';
    const plats = (item.platforms||[]).map(p=>PLAT_ICON[p]||'').join('');
    return '<div class="game-card" onclick="openGameModal('+item.id+')">'+
      '<div class="rank '+rc+'">'+item.rank+'</div>'+
      '<img class="gicon lazy-img" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" data-src="'+thumbUrl(item.icon)+'" alt="" onerror="this.src=\'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2248%22 height=%2248%22%3E%3Crect width=%2248%22 height=%2248%22 fill=%22%23e8e8e8%22 rx=%2210%22/%3E%3C/svg%3E\'">'+
      '<div class="info">'+
        '<div class="line1"><span class="gtitle">'+item.title+'</span>'+hint+'</div>'+
        '<div class="line2"><span class="gscore">'+item.score+'</span>'+tags+'<span class="gplat">'+plats+'</span></div>'+
      '</div>'+
      '<div class="gcount"><div class="gcount-v">'+item.count_str+'</div><div class="gcount-l">'+item.count_label+'</div></div>'+
    '</div>';
  }).join('');
  list.innerHTML = html || '<div class="empty" style="text-align:center;color:#aaa;padding:40px;font-size:14px;">没有匹配的游戏</div>';
  setupLazyLoad();
}

function openGameModal(id) {
  const r = data?.platforms?.[activePlat]?.[activeKey];
  if (!r) return;
  const item = r.items.find(it => it.id === id);
  if (!item) return;
  const tags = (item.tags||[]).map(t => '<span class="gm-tag">'+t+'</span>').join('');
  const plats = (item.platforms||[]).filter(Boolean).join(' / ').toUpperCase();
  let rel = '未知';
  if (item.released_time) {
    if (typeof item.released_time === 'string') rel = item.released_time.split('T')[0];
    else rel = new Date(item.released_time * 1000).toISOString().split('T')[0];
  }
  const hint = item.hints?.[0] ? '<div class="gm-hint">'+item.hints[0]+'</div>' : '';
  document.getElementById('gameModal').innerHTML =
    '<button class="gm-close" onclick="closeGameModal()">✕</button>'+
    '<div class="gm-head">'+
      '<img class="gm-icon" src="'+thumbUrl(item.icon)+'" alt="" onerror="this.src=\'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2248%22 height=%2248%22%3E%3Crect width=%2248%22 height=%2248%22 fill=%22%23e8e8e8%22 rx=%2210%22/%3E%3C/svg%3E\'">'+
      '<div class="gm-info">'+
        '<div class="gm-title">'+item.title+'</div>'+
        '<div class="gm-score">评分 '+item.score+'</div>'+
        '<div class="gm-tags">'+tags+'</div>'+hint+
      '</div>'+
    '</div>'+
    '<div class="gm-body">'+
      (item.developer && item.developer !== '未知' ? '<div class="gm-row"><span>开发者</span><span>'+item.developer+'</span></div>' : '')+
      '<div class="gm-row"><span>平台</span><span>'+(plats||'未知')+'</span></div>'+
      '<div class="gm-row"><span>排名</span><span>#'+item.rank+'</span></div>'+
      '<div class="gm-row"><span>热度</span><span>'+item.count_str+'</span></div>'+
      '<div class="gm-row"><span>上线日期</span><span>'+rel+'</span></div>'+
    '</div>'+
    '<a class="gm-link" href="'+item.url+'" target="_blank">去 TapTap 查看详情 →</a>';
  document.getElementById('gameModalBg').classList.add('show');
  document.body.style.overflow = 'hidden';
}
function closeGameModal() {
  document.getElementById('gameModalBg').classList.remove('show');
  document.body.style.overflow = '';
}

window.addEventListener('resize', () => Object.values(charts).forEach(c => c && c.resize()));
init();
fetch('/ping').catch(() => {});
setInterval(() => fetch('/ping').catch(() => {}), 5000);
