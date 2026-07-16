const RANK_TYPES = [
  {key:'hot',name:'热门榜'},{key:'sell',name:'热卖榜'},{key:'reserve',name:'预约榜'},{key:'new',name:'新品榜'},
  {key:'action',name:'动作榜'},{key:'strategy',name:'策略榜'},{key:'shooter',name:'射击榜'},{key:'roguelike',name:'Roguelike'},
  {key:'casual',name:'休闲榜'},{key:'independent',name:'独立榜'},{key:'acgn',name:'二次元榜'},{key:'otome',name:'乙女榜'},
  {key:'music',name:'音乐榜'},{key:'idle',name:'放置榜'},
];
const PLATFORMS = [{key:'android',name:'Android'},{key:'ios',name:'iOS'}];
const TRANSPARENT_PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
let data=null,activePlat='android',activeKey='hot',currentItems=[],loadGeneration=0,lastFocused=null;
const byId=id=>document.getElementById(id);

function element(tag,{className='',text='',attrs={},children=[]}={}){
  const node=document.createElement(tag);if(className)node.className=className;if(text!==''&&text!==null&&text!==undefined)node.textContent=String(text);
  Object.entries(attrs).forEach(([key,value])=>{if(value!==null&&value!==undefined)node.setAttribute(key,String(value));});children.filter(Boolean).forEach(child=>node.append(child));return node;
}
function safeExternalUrl(value){try{const url=new URL(value);const tapTapHost=url.hostname==='taptap.cn'||url.hostname.endsWith('.taptap.cn');return url.protocol==='https:'&&tapTapHost?url.toString():'';}catch{return '';}}
function safeIconUrl(value){try{const url=new URL(value);return url.protocol==='https:'&&url.hostname==='img-tc.tapimg.com'?url.toString():'';}catch{return '';}}
function applyTheme(theme){document.documentElement.dataset.theme=theme==='light'?'light':'dark';}
function toggleTheme(){const next=document.documentElement.dataset.theme==='dark'?'light':'dark';applyTheme(next);localStorage.setItem('ttm_theme',next);renderDashboard(currentItems);}
applyTheme(localStorage.getItem('ttm_theme')||'dark');

function showSkeleton(){
  const aside=element('aside',{className:'rank-insights',children:[element('div',{className:'dash',children:Array.from({length:4},()=>element('div',{className:'skeleton skeleton-dash'}))})]});
  const results=element('section',{className:'rank-results',children:Array.from({length:8},()=>element('div',{className:'skeleton skeleton-card'}))});
  byId('main').replaceChildren(element('div',{className:'rank-layout',children:[aside,results]}));
}
function stateMessage(title,detail=''){return element('div',{className:'state-message',children:[element('strong',{text:title}),element('span',{text:detail})]});}

async function init(){
  showSkeleton();
  try{
    const response=await fetch('data/meta.json',{cache:'no-cache'});let meta;
    if(response.ok){meta=await response.json();data={updated_at:meta.updated_at,platforms:{},taptap_made_count:meta.taptap_made_count||0};Object.entries(meta.platforms||{}).forEach(([platform,entries])=>{data.platforms[platform]={};Object.entries(entries).forEach(([key,info])=>{data.platforms[platform][key]={title:info.title,description:info.description||'',items:[],_count:info.count};});});}
    else{const fallback=await fetch('data/rankings.json',{cache:'no-cache'});if(!fallback.ok)throw new Error(`HTTP ${fallback.status}`);data=await fallback.json();}
    byId('updateTime').textContent=data.updated_at||'更新时间未知';renderPlatBar();renderTabs();await switchTab(activeKey);
  }catch(error){byId('main').replaceChildren(stateMessage('排行榜数据加载失败',error.message));}
}

function renderPlatBar(){
  byId('platBar').replaceChildren(...PLATFORMS.map(platform=>{const button=element('button',{className:`plat-btn${platform.key===activePlat?' active':''}`,text:platform.name,attrs:{type:'button','data-platform':platform.key,'aria-pressed':platform.key===activePlat}});button.addEventListener('click',()=>switchPlat(platform.key,true));return button;}));
}
async function switchPlat(key,restoreFocus=false){activePlat=key;renderPlatBar();renderTabs();await switchTab(activeKey);if(restoreFocus)byId('platBar').querySelector(`[data-platform="${key}"]`)?.focus();}
function renderTabs(){
  const platform=data?.platforms?.[activePlat]||{};
  byId('tabs').replaceChildren(...RANK_TYPES.map(type=>{const chart=platform[type.key];const count=chart?._count??chart?.items?.length??0;const button=element('button',{className:`tab${type.key===activeKey?' active':''}`,text:`${type.name} ${count}`,attrs:{type:'button','data-key':type.key,'aria-pressed':type.key===activeKey}});button.addEventListener('click',()=>switchTab(type.key,true));return button;}));
}

async function switchTab(key,restoreFocus=false){
  activeKey=key;const generation=++loadGeneration;document.querySelectorAll('.tab').forEach(button=>{const active=button.dataset.key===key;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});
  const chart=data?.platforms?.[activePlat]?.[key];if(!chart){byId('main').replaceChildren(stateMessage('该榜单暂无数据'));return;}
  if(chart._count!==undefined&&chart.items.length===0){showSkeleton();try{const response=await fetch(`data/rankings-${activePlat}-${key}.json`,{cache:'no-cache'});if(!response.ok)throw new Error(`HTTP ${response.status}`);const payload=await response.json();chart.items=payload.items||[];chart.title=payload.title||chart.title;chart.description=payload.description||chart.description||'';}catch(error){if(generation===loadGeneration)byId('main').replaceChildren(stateMessage('榜单数据加载失败',error.message));return;}}
  if(generation!==loadGeneration)return;currentItems=chart.items||[];renderRanking(chart);renderTabs();if(restoreFocus)byId('tabs').querySelector(`[data-key="${key}"]`)?.focus();
}

function chartBox(id,title){return element('article',{className:'dash-box',children:[element('div',{className:'dash-title',text:title}),element('div',{className:'dash-chart',attrs:{id}})]});}
function renderRanking(chart){
  const dashboard=element('div',{className:'dash',children:[chartBox('c-tag','游戏类型分布'),chartBox('c-plat','平台分布'),chartBox('c-score','评分分布'),chartBox('c-heat','热度区间分布')]});
  const aside=element('aside',{className:'rank-insights',children:[dashboard]});
  const search=element('input',{attrs:{id:'searchInput',type:'search',placeholder:'搜索游戏、厂商或标签','aria-label':'搜索游戏、厂商或标签',autocomplete:'off'}});search.addEventListener('input',debounceFilter);
  const results=element('section',{className:'rank-results',children:[
    element('div',{className:'result-head',children:[element('div',{children:[element('h2',{text:chart.title||RANK_TYPES.find(type=>type.key===activeKey)?.name||'榜单'}),element('p',{text:chart.description||`${activePlat==='ios'?'iOS':'Android'} 当前榜单原始记录`})]}),element('strong',{className:'result-total',text:`${currentItems.length} 款`})]}),
    element('div',{className:'search-shell',children:[element('div',{className:'search-bar',children:[search]}),element('div',{className:'search-count',attrs:{id:'searchCount',role:'status','aria-live':'polite','aria-atomic':'true'}})]}),
    element('div',{className:'game-list',attrs:{id:'gameList'}}),
  ]});
  byId('main').replaceChildren(element('div',{className:'rank-layout',children:[aside,results]}));filterGames();requestAnimationFrame(()=>renderDashboard(currentItems));
}

function createIcon(item,className='gicon'){
  const image=element('img',{className:`${className} lazy-img`,attrs:{src:TRANSPARENT_PIXEL,alt:`${item.title||'游戏'} 图标`,loading:'lazy',decoding:'async',referrerpolicy:'no-referrer'}});const source=safeIconUrl(item.icon);if(source)image.dataset.src=source;image.addEventListener('error',()=>{image.removeAttribute('src');image.classList.add('image-error');});return image;
}
function createGameCard(item){
  const rankClass=item.rank<=3?` top${item.rank}`:'';const tags=(item.tags||[]).slice(0,3).map(tag=>element('span',{className:'gtag',text:tag}));
  const platforms=element('span',{className:'gplat',text:(item.platforms||[]).filter(Boolean).map(value=>value.toUpperCase()).join(' · ')});
  const meta=[element('span',{className:'gscore',text:item.score&&item.score!=='-'?`评分 ${item.score}`:'暂无评分'}),element('span',{className:'gdeveloper',text:item.developer||'厂商未知'}),...tags,platforms];
  const hint=item.hints?.[0]?element('span',{className:'ghint',text:item.hints[0]}):null;
  const button=element('button',{className:'game-card',attrs:{type:'button','aria-label':`${item.rank} ${item.title}，查看详情`},children:[element('span',{className:`rank${rankClass}`,text:item.rank}),createIcon(item),element('span',{className:'info',children:[element('span',{className:'line1',children:[element('span',{className:'gtitle',text:item.title||'未知游戏'}),hint]}),element('span',{className:'line2',children:meta})]}),element('span',{className:'gcount',children:[element('span',{className:'gcount-v',text:item.count_str||String(item.count||0)}),element('span',{className:'gcount-l',text:item.count_label||'热度'})]})]});
  button.addEventListener('click',()=>openGameModal(item.id,button));return button;
}

let filterTimer=null;function debounceFilter(){clearTimeout(filterTimer);filterTimer=setTimeout(filterGames,120);}
function filterGames(){
  const query=(byId('searchInput')?.value||'').trim().toLocaleLowerCase('zh-CN');const filtered=query?currentItems.filter(item=>`${item.title||''} ${item.developer||''} ${(item.tags||[]).join(' ')}`.toLocaleLowerCase('zh-CN').includes(query)):currentItems;
  const list=byId('gameList');if(!list)return;list.replaceChildren(...(filtered.length?filtered.map(createGameCard):[stateMessage('没有匹配的游戏','换一个游戏名、厂商或标签试试')])) ;byId('searchCount').textContent=query?`找到 ${filtered.length} 款游戏`:`共 ${filtered.length} 款游戏`;setupLazyLoad();
}

function initChart(id,option){const root=byId(id);if(!root)return;const data=option.series?.[0]?.data||[];const maximum=Math.max(...data.map(row=>row.value),1);root.className='dash-chart chart-bars';root.setAttribute('role','img');const title=root.previousElementSibling?.textContent||'分布';root.setAttribute('aria-label',`${title}：${data.map(row=>`${row.name} ${row.value}`).join('，')||'暂无数据'}`);root.replaceChildren(...data.map(row=>element('div',{className:'chart-bar',children:[element('span',{className:'chart-bar-label',text:row.name}),element('span',{className:'chart-bar-track',children:[element('i',{attrs:{style:`--bar:${Math.max(4,Math.round(row.value/maximum*100))}%`}})]}),element('strong',{text:row.value})]})));}
function donutOption(data){return{series:[{data}]};}
function renderDashboard(items){
  if(!items.length)return;const tagCounts={};items.forEach(item=>(item.tags||[]).forEach(tag=>tagCounts[tag]=(tagCounts[tag]||0)+1));initChart('c-tag',donutOption(Object.entries(tagCounts).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([name,value])=>({name,value}))));
  const platformCounts={};items.forEach(item=>{const key=(item.platforms||[]).filter(Boolean).sort().join('/')||'未知';platformCounts[key]=(platformCounts[key]||0)+1;});initChart('c-plat',donutOption(Object.entries(platformCounts).map(([name,value])=>({name:name.toUpperCase(),value}))));
  const scores={'9+':0,'8–9':0,'7–8':0,'<7':0,'暂无':0};items.forEach(item=>{const value=Number(item.score);if(!value)scores['暂无']++;else if(value>=9)scores['9+']++;else if(value>=8)scores['8–9']++;else if(value>=7)scores['7–8']++;else scores['<7']++;});initChart('c-score',donutOption(Object.entries(scores).filter(([,value])=>value).map(([name,value])=>({name,value}))));
  const max=Math.max(...items.map(item=>item.count||0),0);const heat=max>=10000?{'<1万':0,'1–10万':0,'10–100万':0,'100万+':0}:{'<1千':0,'1–5千':0,'5千–1万':0,'1万+':0};items.forEach(item=>{const value=item.count||0;if(max>=10000){if(value<10000)heat['<1万']++;else if(value<100000)heat['1–10万']++;else if(value<1000000)heat['10–100万']++;else heat['100万+']++;}else if(value<1000)heat['<1千']++;else if(value<5000)heat['1–5千']++;else if(value<10000)heat['5千–1万']++;else heat['1万+']++;});initChart('c-heat',donutOption(Object.entries(heat).filter(([,value])=>value).map(([name,value])=>({name,value}))));
}
let lazyObserver=null;function setupLazyLoad(){lazyObserver?.disconnect();const images=[...document.querySelectorAll('.lazy-img')];images.slice(0,10).forEach(loadImage);if(!('IntersectionObserver'in window)){images.slice(10).forEach(loadImage);return;}lazyObserver=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){loadImage(entry.target);lazyObserver.unobserve(entry.target);}}),{rootMargin:'100px'});images.slice(10).forEach(image=>lazyObserver.observe(image));}
function loadImage(image){if(image.dataset.src){image.src=image.dataset.src;delete image.dataset.src;}}

function modalRow(label,value){return element('div',{className:'gm-row',children:[element('span',{text:label}),element('span',{text:value})]});}
function openGameModal(id,trigger){
  const item=currentItems.find(entry=>entry.id===id);if(!item)return;lastFocused=trigger;const released=item.released_time?new Date(Number(item.released_time)*1000).toISOString().slice(0,10):'未知';const url=safeExternalUrl(item.url);
  const close=element('button',{className:'gm-close',text:'×',attrs:{type:'button','aria-label':'关闭详情'}});close.addEventListener('click',closeGameModal);
  const head=element('div',{className:'gm-head',children:[createIcon(item,'gm-icon'),element('div',{className:'gm-info',children:[element('div',{className:'gm-title',text:item.title||'未知游戏'}),element('div',{className:'gm-score',text:item.score&&item.score!=='-'?`评分 ${item.score}`:'暂无评分'}),element('div',{className:'gm-tags',children:(item.tags||[]).map(tag=>element('span',{className:'gm-tag',text:tag}))}),item.hints?.[0]?element('div',{className:'gm-hint',text:item.hints[0]}):null]})]});
  const body=element('div',{className:'gm-body',children:[modalRow('厂商 / 账号',item.developer||'未知'),modalRow('平台',(item.platforms||[]).filter(Boolean).join(' / ').toUpperCase()||'未知'),modalRow('排名',`#${item.rank}`),modalRow('热度',item.count_str||String(item.count||0)),modalRow('上线日期',released)]});
  const children=[close,head,body];if(url)children.push(element('a',{className:'gm-link',text:'去 TapTap 查看详情 →',attrs:{href:url,target:'_blank',rel:'noopener noreferrer'}}));byId('gameModal').replaceChildren(...children);loadImage(byId('gameModal').querySelector('.gm-icon'));const dialog=byId('gameModalBg');dialog.classList.add('show');dialog.showModal();document.body.style.overflow='hidden';close.focus();
}
function closeGameModal(){const dialog=byId('gameModalBg');if(dialog.open)dialog.close();}

async function doRefresh(){
  const button=byId('btnRefresh');button.disabled=true;button.replaceChildren(element('span',{className:'spinner'}));try{const response=await fetch('/refresh',{method:'POST',headers:{'X-TTMRank-Request':'refresh'}});const payload=await response.json();if(!response.ok||!payload.success)throw new Error(payload.error||`HTTP ${response.status}`);await init();}catch(error){alert(`刷新失败：${error.message}`);}finally{button.disabled=false;button.textContent='↻';}
}
const localPorts=['8080','8081','8082','8083','8084','8085','8086','8087','8088','8089'];const localRefresh=(location.hostname==='127.0.0.1'||location.hostname==='localhost')&&localPorts.includes(location.port);
byId('btnRefresh').addEventListener('click',doRefresh);byId('btnTheme').addEventListener('click',toggleTheme);byId('btnRefresh').hidden=!localRefresh;
byId('gameModalBg').addEventListener('click',event=>{if(event.target===byId('gameModalBg'))closeGameModal();});byId('gameModalBg').addEventListener('keydown',event=>{if(event.key!=='Tab')return;const focusable=[...byId('gameModal').querySelectorAll('button:not([disabled]),a[href]')];if(!focusable.length)return;const first=focusable[0],last=focusable.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}});byId('gameModalBg').addEventListener('close',()=>{byId('gameModalBg').classList.remove('show');document.body.style.overflow='';const target=lastFocused;lastFocused=null;target?.focus();});
if(localRefresh){fetch('/ping').catch(()=>{});setInterval(()=>fetch('/ping').catch(()=>{}),5000);}
init();
