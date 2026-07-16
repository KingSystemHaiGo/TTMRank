import { buildBoards } from './boards.js';
import { renderCharts, resizeCharts } from './charts.js';
import { loadAnalysis, loadQuality } from './data-client.js';
import { DEFAULT_FILTERS, applyFilters } from './filters.js';
import { coreMetrics, typeSummary } from './metrics.js';
import { describeReport, printReport, setReportMode } from './report.js';
import { exportLongImage } from './export.js';
import { renderBoards, renderDrawer, renderMetrics, renderTypeList } from './table.js';
import { parseState, serializeState } from '../core/state-url.js';
import { analyzeMakerOpportunities } from './opportunity.js';
import { renderOpportunities } from './opportunity-view.js';

let original=null; let filtered=null; let manifest=null; let filters={...DEFAULT_FILTERS}; let reportMode=false; let debounceTimer=null; let lastDetailTrigger=null;
const APP_DEFAULT_FILTERS={...DEFAULT_FILTERS,scope:'made'};
const byId=id=>document.getElementById(id);
const numberValue=id=>byId(id).value===''?null:Number(byId(id).value);
const timeValue=id=>byId(id).value?Math.floor(new Date(byId(id).value).getTime()/1000):null;

function syncControls(){
  document.querySelectorAll('[data-scope]').forEach(button=>{const active=button.dataset.scope===filters.scope;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});
  document.querySelectorAll('[data-platform]').forEach(button=>{const active=button.dataset.platform===filters.platform;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});
  ['released','baseline'].forEach(id=>byId(id).value=filters[id]); ['query'].forEach(id=>byId(id).value=filters[id]||'');
  ['heatMin','heatMax','dailyHeatMin','dailyHeatMax','growth24hMin','growth24hMax','scoreMin','scoreMax','rankMin','rankMax','highScore'].forEach(id=>byId(id).value=filters[id]??'');
  ['releasedFrom','releasedTo'].forEach(id=>byId(id).value=filters[id]?new Date(filters[id]*1000).toISOString().slice(0,16):'');
  [...byId('charts').options].forEach(option=>option.selected=filters.charts.includes(option.value));
  byId('tags').value=filters.tags.join(', '); byId('tagMode').value=filters.tagMode;
}

function readControls(){
  filters={...filters,released:byId('released').value,query:byId('query').value.trim(),heatMin:numberValue('heatMin'),heatMax:numberValue('heatMax'),dailyHeatMin:numberValue('dailyHeatMin'),dailyHeatMax:numberValue('dailyHeatMax'),growth24hMin:numberValue('growth24hMin'),growth24hMax:numberValue('growth24hMax'),scoreMin:numberValue('scoreMin'),scoreMax:numberValue('scoreMax'),rankMin:numberValue('rankMin'),rankMax:numberValue('rankMax'),baseline:byId('baseline').value,highScore:numberValue('highScore')??8.5,releasedFrom:timeValue('releasedFrom'),releasedTo:timeValue('releasedTo'),charts:[...byId('charts').selectedOptions].map(option=>option.value),tags:byId('tags').value.split(',').map(value=>value.trim()).filter(Boolean),tagMode:byId('tagMode').value};
}

function openDetail(gameId,trigger){
  const game=filtered.games.find(item=>item.id===gameId); if(!game)return; const metric=filtered.metrics.find(item=>item.game_id===gameId); const rows=filtered.appearances.filter(item=>item.game_id===gameId);
  lastDetailTrigger=trigger instanceof HTMLElement?trigger:document.activeElement instanceof HTMLElement?document.activeElement:null;
  renderDrawer(byId('drawerContent'),game,metric,rows); const dialog=byId('drawerBg'); if(!dialog.open)dialog.showModal();dialog.classList.add('show');document.body.style.overflow='hidden';byId('drawerClose').focus();
}
function closeDetail(){const dialog=byId('drawerBg');if(dialog.open)dialog.close();}

function render(){
  filtered=applyFilters(original,filters); const metrics=coreMetrics(filtered,filters.highScore); const baselineData=filters.baseline==='fixed'?original:filtered; const baselineMetrics=coreMetrics(baselineData,filters.highScore); const boards=buildBoards(filtered,{platform:filters.platform,baselineMetrics});
  renderMetrics(byId('metrics'),metrics); renderCharts(filtered,metrics); renderTypeList(byId('typeList'),typeSummary(filtered)); renderBoards(byId('boards'),boards,filtered,openDetail);
  renderOpportunities(byId('opportunities'),analyzeMakerOpportunities(original,byId('profileSelect').value));
  byId('heatSamples').textContent=`${metrics.heatSamples} 个有效样本`; byId('resultCount').textContent=`当前收录 ${filtered.games.length} 款`; byId('scopeNote').textContent=`${filters.scope==='made'?'TapTap制造':'全榜单'} · ${filters.platform==='all'?'全部平台':filters.platform}`;
  byId('reportMeta').textContent=`${describeReport(filters,filtered.games.length,new Date().toLocaleString('zh-CN',{hour12:false}))} · schema ${manifest.schema_version}`;
  history.replaceState(null,'',`${location.pathname}${serializeState(filters)}`); syncControls();
}
function scheduleRender(){clearTimeout(debounceTimer);debounceTimer=setTimeout(()=>{readControls();render();},180);}

function bind(){
  document.querySelectorAll('[data-scope]').forEach(button=>button.addEventListener('click',()=>{filters.scope=button.dataset.scope;render();}));
  document.querySelectorAll('[data-platform]').forEach(button=>button.addEventListener('click',()=>{filters.platform=button.dataset.platform;render();}));
  ['released','query','heatMin','heatMax','dailyHeatMin','dailyHeatMax','growth24hMin','growth24hMax','scoreMin','scoreMax','rankMin','rankMax','baseline','highScore','releasedFrom','releasedTo','charts','tags','tagMode'].forEach(id=>byId(id).addEventListener(id==='query'||id==='tags'?'input':'change',scheduleRender));
  byId('profileSelect').addEventListener('change',render);
  byId('advancedBtn').addEventListener('click',()=>{const hidden=byId('advancedPanel').classList.toggle('hidden');byId('advancedBtn').setAttribute('aria-expanded',String(!hidden));});
  byId('resetBtn').addEventListener('click',()=>{filters={...APP_DEFAULT_FILTERS};render();});
  byId('reportBtn').addEventListener('click',()=>{reportMode=setReportMode(!reportMode);setTimeout(resizeCharts,50);}); byId('printBtn').addEventListener('click',printReport);
  byId('imageBtn').addEventListener('click',()=>exportLongImage(document.querySelector('main')));
  byId('themeBtn').addEventListener('click',()=>{const next=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=next;localStorage.setItem('ttm_theme',next);setTimeout(()=>{render();},50);});
  byId('drawerClose').addEventListener('click',closeDetail);const drawerDialog=byId('drawerBg');drawerDialog.addEventListener('click',event=>{if(event.target===drawerDialog)closeDetail();});drawerDialog.addEventListener('keydown',event=>{if(event.key!=='Tab')return;const focusable=[...byId('drawer').querySelectorAll('button:not([disabled]),a[href]')];if(!focusable.length)return;const first=focusable[0],last=focusable.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}});drawerDialog.addEventListener('close',()=>{drawerDialog.classList.remove('show');document.body.style.overflow='';const trigger=lastDetailTrigger;lastDetailTrigger=null;trigger?.focus();});window.addEventListener('resize',resizeCharts);
}

async function init(){
  try{
    document.documentElement.dataset.theme=localStorage.getItem('ttm_theme')||'dark'; filters=parseState(location.search,APP_DEFAULT_FILTERS); syncControls(); bind();
    const loaded=await loadAnalysis(); manifest=loaded.manifest; original=loaded.data; byId('updatedAt').textContent=manifest.updated_at; const quality=await loadQuality();
    const notices=[];
    if(quality?.issues?.length)notices.push(`本批次记录 ${quality.issues.length} 个跨榜字段差异，主数据使用最新有效值。`);
    if(!manifest.history_available)notices.push('近期增量暂不可用；当前仍可使用生命周期小时口径日均热度，配置 D1 后自动启用近期增长。');
    if(notices.length){byId('qualityBanner').classList.remove('hidden');byId('qualityBanner').textContent=`数据质量提示：${notices.join(' ')}`;}
    render();
  }catch(error){byId('metrics').replaceChildren();const node=document.createElement('div');node.className='empty';node.textContent=`分析数据加载失败：${error.message}`;byId('metrics').append(node);console.error(error);}
}
init();
