const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });
const allowedOrigins = env => new Set((env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean));
function cors(request, env) { const origin=request.headers.get('Origin')||''; return allowedOrigins(env).has(origin) ? {'Access-Control-Allow-Origin':origin,'Vary':'Origin'} : {}; }
function validInteger(value) { const number=Number(value); return Number.isSafeInteger(number) ? number : null; }

async function series(request, env, url) {
  const gameId=validInteger(url.searchParams.get('game_id')); const from=validInteger(url.searchParams.get('from')); const to=validInteger(url.searchParams.get('to'));
  if(!gameId||!from||!to||from>=to||to-from>90*86400) return json({error:'invalid series parameters'},400,cors(request,env));
  const result=await env.DB.prepare('SELECT captured_hour, heat, score FROM game_heat_hourly WHERE game_id=? AND captured_hour BETWEEN ? AND ? ORDER BY captured_hour').bind(gameId,from,to).all();
  return json({game_id:gameId,points:result.results},200,{...cors(request,env),'Cache-Control':'public, max-age=300'});
}

async function baselines(request, env, url) {
  const at=validInteger(url.searchParams.get('at'))||Math.floor(Date.now()/1000);
  const ids=(url.searchParams.get('game_ids')||'').split(',').map(validInteger).filter(Boolean).slice(0,100);
  if(!ids.length) return json({error:'game_ids required'},400,cors(request,env));
  const placeholders=ids.map(()=>'?').join(','); const moments=[at-3600,at-86400,at-7*86400];
  const result=await env.DB.prepare(`SELECT game_id,captured_hour,heat,score FROM game_heat_hourly WHERE game_id IN (${placeholders}) AND captured_hour BETWEEN ? AND ? ORDER BY captured_hour`).bind(...ids,moments[2]-43200,at).all();
  return json({at,points:result.results},200,cors(request,env));
}

async function ingest(request, env) {
  if(!env.INGEST_TOKEN || request.headers.get('X-Ingest-Token')!==env.INGEST_TOKEN) return json({error:'unauthorized'},401,cors(request,env));
  if(Number(request.headers.get('Content-Length')||0)>1_000_000) return json({error:'request too large'},413,cors(request,env));
  const body=await request.json(); if(!Array.isArray(body.snapshots)||body.snapshots.length>2000) return json({error:'invalid snapshots'},400,cors(request,env));
  const statements=body.snapshots.map(row=>env.DB.prepare('INSERT INTO game_heat_hourly(game_id,captured_hour,heat,score) VALUES(?,?,?,?) ON CONFLICT(game_id,captured_hour) DO UPDATE SET heat=excluded.heat,score=excluded.score').bind(validInteger(row.game_id),validInteger(row.captured_hour),validInteger(row.heat),row.score==null?null:Number(row.score)));
  await env.DB.batch(statements); return json({ok:true,written:statements.length},200,cors(request,env));
}

async function icon(request, env, url) {
  let source; try{source=new URL(url.searchParams.get('url')||'');}catch{return json({error:'invalid icon URL'},400,cors(request,env));}
  if(source.protocol!=='https:'||source.hostname!=='img-tc.tapimg.com') return json({error:'icon host not allowed'},403,cors(request,env));
  const cache=await caches.open('ttmrank-icons'); const key=new Request(url.toString(),{method:'GET'}); const cached=await cache.match(key); if(cached)return cached;
  const upstream=await fetch(source.toString(),{headers:{'Referer':'https://www.taptap.cn/'},redirect:'manual'}); const type=upstream.headers.get('Content-Type')||''; const length=Number(upstream.headers.get('Content-Length')||0);
  if(!upstream.ok||!type.startsWith('image/')||length>2_000_000) return json({error:'invalid upstream image'},502,cors(request,env));
  const response=new Response(upstream.body,{status:200,headers:{'Content-Type':type,'Cache-Control':'public, max-age=31536000, immutable','Access-Control-Allow-Origin':'*','Cross-Origin-Resource-Policy':'cross-origin'}}); await cache.put(key,response.clone()); return response;
}

export default {async fetch(request,env){const url=new URL(request.url);if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...cors(request,env),'Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type,X-Ingest-Token'}});if(url.pathname==='/v1/series'&&request.method==='GET')return series(request,env,url);if(url.pathname==='/v1/baselines'&&request.method==='GET')return baselines(request,env,url);if(url.pathname==='/v1/snapshots'&&request.method==='POST')return ingest(request,env);if(url.pathname==='/v1/icon'&&request.method==='GET')return icon(request,env,url);return json({error:'not found'},404,cors(request,env));}};

export const __test = { allowedOrigins, validInteger };
