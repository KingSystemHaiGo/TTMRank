const IMMUTABLE_FILE = /\.[a-f0-9]{16,64}\.json$/i;
const TRANSIENT_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export function immutableDataUrl(path, sha = '') {
  if (IMMUTABLE_FILE.test(path)) return path;
  const digest = String(sha || '');
  return /^[a-f0-9]{64}$/i.test(digest) ? `${path}?v=${digest.slice(0, 16)}` : path;
}

function delay(ms) {
  return ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve();
}

function transient(error, { retryTimeouts = true } = {}) {
  if (error?.requestTimeout === true) return retryTimeouts;
  return error?.transient === true || error?.name === 'AbortError' || error instanceof TypeError;
}

async function requestJson(url, { fetcher, cache, timeoutMs }) {
  const controller = fetcher === globalThis.fetch && typeof AbortController === 'function'
    ? new AbortController()
    : null;
  const options = controller ? { cache, signal: controller.signal } : { cache };
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller?.abort();
      const error = new Error(`request timeout after ${timeoutMs}ms`);
      error.name = 'AbortError';
      error.requestTimeout = true;
      error.transient = true;
      reject(error);
    }, timeoutMs);
  });
  const request = (async () => {
    const response = await fetcher(url, options);
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}`);
      error.transient = TRANSIENT_STATUS.has(response.status);
      throw error;
    }
    return response.json();
  })();
  try {
    return await Promise.race([request, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJsonWithRetry(url, {
  fetcher = fetch,
  cache = 'force-cache',
  timeoutMs = 10_000,
  retries = 1,
  retryTimeouts = true,
  retryDelayMs = 180,
} = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await requestJson(url, { fetcher, cache, timeoutMs });
    } catch (error) {
      lastError = error;
      if (attempt >= retries || !transient(error, { retryTimeouts })) throw error;
      await delay(retryDelayMs * (attempt + 1));
    }
  }
  throw lastError;
}
