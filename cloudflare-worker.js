// Cloudflare Workers 代理脚本
// 把 API key 藏在后端，前端零配置使用 AI 总结
//
// 部署步骤：
// 1. 注册 https://dash.cloudflare.com（免费）
// 2. Workers & Pages → Create application → Create Worker
// 3. 把下面代码贴进去，保存
// 4. Settings → Variables → 添加环境变量：
//    LLM_URL = https://api.deepseek.com/chat/completions
//    LLM_KEY  = sk-你的APIKey
// 5. 拿到 Worker URL（如 https://ttmrank-proxy.xxx.workers.dev）
// 6. 把 URL 填到 app/js/app.js 和 app/taptapmaker.html 的 DEFAULT_WORKER_URL 里

const origins = env => new Set((env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean));
const models = env => new Set((env.LLM_MODELS || 'deepseek-chat').split(',').map(value => value.trim()).filter(Boolean));
const isOriginAllowed = (origin, env) => Boolean(origin) && origins(env).has(origin);
const bodyLimit = env => Math.max(1, Math.min(Number(env.MAX_BODY_BYTES || 262144), 1_000_000));
const tokenLimit = env => Math.max(1, Math.min(Number(env.MAX_TOKENS || 4096), 8192));
const cors = origin => ({ 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin' });
const json = (data, status, origin) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors(origin) } });

function validatePayload(payload, env) {
  if (!payload || typeof payload !== 'object' || !models(env).has(payload.model)) return { ok: false, error: 'model not allowed' };
  if (!Array.isArray(payload.messages) || payload.messages.length > 64) return { ok: false, error: 'invalid messages' };
  const maxTokens = Number(payload.max_tokens || tokenLimit(env));
  if (!Number.isSafeInteger(maxTokens) || maxTokens < 1 || maxTokens > tokenLimit(env)) return { ok: false, error: 'max_tokens exceeds limit' };
  return { ok: true, payload: { ...payload, max_tokens: maxTokens, stream: false } };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    if (!isOriginAllowed(origin, env)) return new Response('Forbidden', { status: 403 });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...cors(origin), 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
    if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405, origin);
    if (!env.LLM_KEY || !env.LLM_URL) return json({ error: 'LLM proxy not configured' }, 503, origin);
    const declared = Number(request.headers.get('Content-Length') || 0);
    if (declared > bodyLimit(env)) return json({ error: 'request too large' }, 413, origin);
    const text = await request.text();
    if (!text || new TextEncoder().encode(text).length > bodyLimit(env)) return json({ error: 'request too large' }, 413, origin);
    let payload;
    try { payload = JSON.parse(text); } catch { return json({ error: 'invalid JSON' }, 400, origin); }
    const checked = validatePayload(payload, env);
    if (!checked.ok) return json({ error: checked.error }, 400, origin);
    const upstream = await fetch(env.LLM_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.LLM_KEY}` }, body: JSON.stringify(checked.payload) });
    return new Response(upstream.body, { status: upstream.status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors(origin) } });
  }
};

export const __test = { bodyLimit, isOriginAllowed, validatePayload };
