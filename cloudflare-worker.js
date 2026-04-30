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

export default {
  async fetch(request, env) {
    // CORS 预检
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization'
        }
      });
    }

    const LLM_URL = env.LLM_URL || 'https://api.deepseek.com/chat/completions';
    const LLM_KEY = env.LLM_KEY;

    if (!LLM_KEY) {
      return new Response(JSON.stringify({error: 'LLM_KEY not configured'}), {
        status: 500,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    if (request.method !== 'POST') {
      return new Response('TTMRank LLM Proxy is running. Send a POST request with JSON body.', {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }

    const body = await request.text();
    if (!body) {
      return new Response(JSON.stringify({error: 'Empty request body'}), {
        status: 400,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    const resp = await fetch(LLM_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + LLM_KEY
      },
      body: body
    });

    return new Response(resp.body, {
      status: resp.status,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
};
