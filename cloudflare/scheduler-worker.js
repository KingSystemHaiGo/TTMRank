function config(env) {
  const token = typeof env.GITHUB_ACTIONS_TOKEN === 'string' ? env.GITHUB_ACTIONS_TOKEN.trim() : '';
  const repository = typeof env.GITHUB_REPOSITORY === 'string' ? env.GITHUB_REPOSITORY.trim() : '';
  const workflow = typeof env.GITHUB_WORKFLOW === 'string' ? env.GITHUB_WORKFLOW.trim() : '';
  const ref = typeof env.GITHUB_REF === 'string' ? env.GITHUB_REF.trim() : '';
  if (!token
    || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)
    || !/^[A-Za-z0-9_.-]+(?:\.ya?ml)?$/.test(workflow)
    || !/^[A-Za-z0-9._\/-]+$/.test(ref)) {
    throw new Error('GitHub dispatch configuration is missing or invalid');
  }
  return { token, repository, workflow, ref };
}

export async function dispatchRefresh(env, fetcher = fetch) {
  const { token, repository, workflow, ref } = config(env);
  const endpoint = `https://api.github.com/repos/${repository}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`;
  const response = await fetcher(endpoint, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'TTMRank-Cloudflare-Scheduler',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({ ref }),
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status !== 204) {
    throw new Error(`GitHub dispatch failed with HTTP ${response.status}`);
  }
  return { status: response.status };
}

export default {
  async fetch() {
    return new Response('TTMRank scheduler is active.', {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  },
  async scheduled(_controller, env, context) {
    context.waitUntil(dispatchRefresh(env));
  },
};
