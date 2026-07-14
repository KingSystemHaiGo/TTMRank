import { buildBoards } from './boards.js';
import { renderCharts, resizeCharts } from './charts.js';
import { loadAnalysis, loadQuality } from './data-client.js';
import { DEFAULT_FILTERS, applyFilters } from './filters.js';
import { coreMetrics, typeSummary } from './metrics.js';
import { printReport, setReportMode } from './report.js';
import { renderBoards, renderDrawer, renderMetrics, renderTypeList } from './table.js';
import { parseState, serializeState } from '../core/state-url.js';

let original=null; let filtered=null; let manifest=null; let filters={...DEFAULT_FILTERS}; let reportMode=false; let debounceTimer=null;
const byId=id=>document.getElementById(id);
const numberValue=id=>byId(id).value===''?null:Number(byId(id).value);
const timeValue=id=>byId(id).value?Math.floor(new Date(byId(id).value).getTime()/1000):null;

function syncControls(){
  document.querySelectorAll('[data-scope]').forEach(button=>button.classList.toggle('active',button.dataset.scope===filters.scope));
  document.querySelectorAll('[data-platform]').forEach(button=>button.classList.toggle('active',button.dataset.platform===filters.platform));
  ['released','baseline'].forEach(id=>byId(id).value=filters[id]); ['query'].forEach(id=>byId(id).value=filters[id]||'');
  ['heatMin','heatMax','dailyHeatMin','dailyHeatMax','scoreMin','scoreMax','rankMin','rankMax','highScore'].forEach(id=>byId(id).value=filters[id]??'');
  ['releasedFrom','releasedTo'].forEach(id=>byId(id).value=filters[id]?new Date(filters[id]*1000).toISOString().slice(0,16):'');
}

function readControls(){
  filters={...filters,released:byId('released').value,query:byId('query').value.trim(),heatMin:numberValue('heatMin'),heatMax:numberValue('heatMax'),dailyHeatMin:numberValue('dailyHeatMin'),dailyHeatMax:numberValue('dailyHeatMax'),scoreMin:numberValue('scoreMin'),scoreMax:numberValue('scoreMax'),rankMin:numberValue('rankMin'),rankMax:numberValue('rankMax'),baseline:byId('baseline').value,highScore:numberValue('highScore')??8.5,releasedFrom:timeValue('releasedFrom'),releasedTo:timeValue('releasedTo')};
}

function openDetail(gameId){
  const game=filtered.games.find(item=>item.id===gameId); if(!game)return; const metric=filtered.metrics.find(item=>item.game_id===gameId); const rows=filtered.appearances.filter(item=>item.game_id===gameId);
  renderDrawer(byId('drawerContent'),game,metric,rows); byId('drawerBg').classList.add('show'); byId('drawerBg').setAttribute('aria-hidden','false'); document.body.style.overflow='hidden';
}
function closeDetail(){byId('drawerBg').classList.remove('show');byId('drawerBg').setAttribute('aria-hidden','true');document.body.style.overflow='';}

function render(){
  filtered=applyFilters(original,filters); const metrics=coreMetrics(filtered,filters.highScore); const boards=buildBoards(filtered,{platform:filters.platform});
  renderMetrics(byId('metrics'),metrics); renderCharts(filtered,metrics); renderTypeList(byId('typeList'),typeSummary(filtered)); renderBoards(byId('boards'),boards,filtered,openDetail);
  byId('heatSamples').textContent=`${metrics.heatSamples} 个有效样本`; byId('resultCount').textContent=`当前收录 ${filtered.games.length} 款`; byId('scopeNote').textContent=`${filters.scope==='made'?'TapTap制造':'全榜单'} · ${filters.platform==='all'?'全部平台':filters.platform}`;
  byId('reportMeta').textContent=`筛选样本 ${filtered.games.length} · schema ${manifest.schema_version} · ${filters.baseline==='dynamic'?'动态基准':'固定基准'}`;
  history.replaceState(null,'',`${location.pathname}${serializeState(filters)}`); syncControls();
}
function scheduleRender(){clearTimeout(debounceTimer);debounceTimer=setTimeout(()=>{readControls();render();},180);}

function bind(){
  document.querySelectorAll('[data-scope]').forEach(button=>button.addEventListener('click',()=>{filters.scope=button.dataset.scope;render();}));
  document.querySelectorAll('[data-platform]').forEach(button=>button.addEventListener('click',()=>{filters.platform=button.dataset.platform;render();}));
  ['released','query','heatMin','heatMax','dailyHeatMin','dailyHeatMax','scoreMin','scoreMax','rankMin','rankMax','baseline','highScore','releasedFrom','releasedTo'].forEach(id=>byId(id).addEventListener(id==='query'?'input':'change',scheduleRender));
  byId('advancedBtn').addEventListener('click',()=>{const hidden=byId('advancedPanel').classList.toggle('hidden');byId('advancedBtn').setAttribute('aria-expanded',String(!hidden));});
  byId('resetBtn').addEventListener('click',()=>{filters={...DEFAULT_FILTERS};render();});
  byId('reportBtn').addEventListener('click',()=>{reportMode=setReportMode(!reportMode);setTimeout(resizeCharts,50);}); byId('printBtn').addEventListener('click',printReport);
  byId('themeBtn').addEventListener('click',()=>{const next=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=next;localStorage.setItem('ttm_theme',next);setTimeout(()=>{render();},50);});
  byId('drawerClose').addEventListener('click',closeDetail);byId('drawerBg').addEventListener('click',event=>{if(event.target===byId('drawerBg'))closeDetail();});window.addEventListener('keydown',event=>{if(event.key==='Escape')closeDetail();});window.addEventListener('resize',resizeCharts);
}

async function init(){
  try{
    document.documentElement.dataset.theme=localStorage.getItem('ttm_theme')||'dark'; filters=parseState(location.search,DEFAULT_FILTERS); syncControls(); bind();
    const loaded=await loadAnalysis(); manifest=loaded.manifest; original=loaded.data; byId('updatedAt').textContent=manifest.updated_at; const quality=await loadQuality();
    if(quality?.issues?.length){byId('qualityBanner').classList.remove('hidden');byId('qualityBanner').textContent=`数据质量提示：本批次记录 ${quality.issues.length} 个跨榜字段差异，主数据使用最新有效值。`;}
    render();
  }catch(error){byId('metrics').replaceChildren();const node=document.createElement('div');node.className='empty';node.textContent=`分析数据加载失败：${error.message}`;byId('metrics').append(node);console.error(error);}
}
init();
