import { compactNumber } from '../core/format.js';

const instances = new Map();
function chart(id) { if (!window.echarts) return null; if (!instances.has(id)) instances.set(id, window.echarts.init(document.getElementById(id))); return instances.get(id); }
const textColor = () => getComputedStyle(document.documentElement).getPropertyValue('--text-2').trim();
const lineColor = () => getComputedStyle(document.documentElement).getPropertyValue('--line').trim();

export function renderCharts(data, metrics) {
  const heat = chart('heatChart'); const scatter = chart('scatterChart');
  if (!heat || !scatter) return;
  const heats=data.games.map(game=>game.heat).filter(Boolean); const max=Math.max(...heats,1); const bucketCount=12; const bucketSize=max/bucketCount; const buckets=Array.from({length:bucketCount},()=>0);
  heats.forEach(value=>buckets[Math.min(Math.floor(value/bucketSize),bucketCount-1)]++);
  heat.setOption({animationDuration:500,grid:{left:48,right:20,top:28,bottom:40},tooltip:{trigger:'axis',formatter:items=>`${items[0].axisValue}<br>${items[0].value} 款`},xAxis:{type:'category',data:buckets.map((_,i)=>compactNumber(i*bucketSize)),axisLabel:{color:textColor(),fontSize:10},axisLine:{lineStyle:{color:lineColor()}}},yAxis:{type:'value',axisLabel:{color:textColor()},splitLine:{lineStyle:{color:lineColor()}}},series:[{type:'bar',data:buckets,itemStyle:{color:'#16d3c6',borderRadius:[5,5,0,0]}}]});
  const metricMap=new Map(data.metrics.map(item=>[item.game_id,item]));
  scatter.setOption({animationDuration:500,grid:{left:55,right:25,top:28,bottom:42},tooltip:{formatter:params=>`${params.data[2]}<br>评分 ${params.data[0]} · 热度 ${compactNumber(params.data[1])}`},xAxis:{type:'value',min:0,max:10,name:'评分',nameTextStyle:{color:textColor()},axisLabel:{color:textColor()},splitLine:{lineStyle:{color:lineColor()}}},yAxis:{type:'log',name:'热度',nameTextStyle:{color:textColor()},axisLabel:{color:textColor(),formatter:compactNumber},splitLine:{lineStyle:{color:lineColor()}}},series:[{type:'scatter',symbolSize:value=>Math.max(7,Math.min(24,Math.log10(value[1]+1)*3)),data:data.games.filter(game=>game.score&&game.heat>0).map(game=>[game.score,game.heat,game.title,metricMap.get(game.id)?.heat_per_day_lifetime]),itemStyle:{color:'#16d3c6',opacity:.72},markLine:{silent:true,lineStyle:{color:'#ffae38',type:'dashed'},data:[{xAxis:metrics.scoreMedian},{yAxis:metrics.heatMedian}]}}]});
}
export function resizeCharts(){instances.forEach(instance=>instance.resize());}
export function disposeCharts(){instances.forEach(instance=>instance.dispose());instances.clear();}
