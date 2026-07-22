export const LIVE_REFRESH_INTERVAL_MS = 5 * 60_000;
export const LIVE_REFRESH_MIN_GAP_MS = 30_000;
export const STALE_AFTER_SECONDS = 60 * 60;

export function freshnessText(manifest, nowSeconds = Math.floor(Date.now() / 1000)) {
  const observedAt = Number(manifest?.observed_at);
  const updatedAt = String(manifest?.updated_at || '未知');
  const delayed = Number.isSafeInteger(observedAt)
    && Number.isFinite(nowSeconds)
    && nowSeconds - observedAt > STALE_AFTER_SECONDS;
  return delayed
    ? `数据更新延迟 · 最后采集 ${updatedAt}`
    : `最近采集 ${updatedAt}`;
}

export function createLiveRefresh({
  check,
  documentTarget = document,
  windowTarget = window,
  intervalMs = LIVE_REFRESH_INTERVAL_MS,
  minCheckGapMs = LIVE_REFRESH_MIN_GAP_MS,
  now = () => Date.now(),
  setTimer = (callback, delay) => setTimeout(callback, delay),
  clearTimer = timer => clearTimeout(timer),
  onError = () => {},
} = {}) {
  if (typeof check !== 'function') throw new TypeError('check must be a function');
  let stopped = true;
  let timer = null;
  let inFlight = null;
  let lastCheckedAt = 0;

  const visible = () => documentTarget.visibilityState !== 'hidden';

  function cancelTimer() {
    if (timer === null) return;
    clearTimer(timer);
    timer = null;
  }

  function schedule(delay = intervalMs) {
    cancelTimer();
    if (stopped || !visible()) return;
    timer = setTimer(() => {
      timer = null;
      void requestCheck();
    }, Math.max(0, delay));
  }

  function requestCheck({ force = false } = {}) {
    if (stopped || !visible()) return Promise.resolve(false);
    if (inFlight) return inFlight;
    const elapsed = now() - lastCheckedAt;
    if (!force && elapsed < minCheckGapMs) {
      schedule(Math.min(intervalMs, minCheckGapMs - elapsed));
      return Promise.resolve(false);
    }

    cancelTimer();
    lastCheckedAt = now();
    inFlight = Promise.resolve()
      .then(check)
      .catch(error => {
        onError(error);
        return false;
      })
      .finally(() => {
        inFlight = null;
        schedule(intervalMs);
      });
    return inFlight;
  }

  function handleVisibility() {
    if (!visible()) {
      cancelTimer();
      return;
    }
    void requestCheck();
  }

  function handleFocus() {
    if (visible()) void requestCheck();
  }

  function start() {
    if (!stopped) return;
    stopped = false;
    lastCheckedAt = now();
    documentTarget.addEventListener('visibilitychange', handleVisibility);
    windowTarget.addEventListener('focus', handleFocus);
    schedule(intervalMs);
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    cancelTimer();
    documentTarget.removeEventListener('visibilitychange', handleVisibility);
    windowTarget.removeEventListener('focus', handleFocus);
  }

  return { start, stop, checkNow: () => requestCheck({ force: true }) };
}
