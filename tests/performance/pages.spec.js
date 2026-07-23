import { test, expect } from '@playwright/test';

const primary = [
  ['/index.html', '#freshness'],
  ['/changes.html', '#changesFreshness'],
  ['/universe.html', '#universeCount'],
  ['/analysis.html', '.metric-card'],
  ['/rankings.html', '.game-card'],
];

test('primary views render without stylesheet, application, or data fetches', async ({ page }) => {
  const runtimeErrors = [];
  page.on('pageerror', error => runtimeErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') runtimeErrors.push(message.text());
  });
  for (const [path, ready] of primary) {
    const requests = [];
    const collect = request => requests.push(request.url());
    page.on('request', collect);
    await page.goto(path);
    await expect(page.locator(ready).first()).toBeVisible();
    if (path.includes('analysis')) await expect(page.locator('.metric-card')).toHaveCount(8);
    if (path.includes('rankings')) await expect(page.locator('.game-card')).toHaveCount(150);
    const avoidable = requests.filter(url => {
      const value = new URL(url);
      return value.origin === 'http://127.0.0.1:4174'
        && (/\/data\//u.test(value.pathname)
          || /\/css\//u.test(value.pathname)
          || /\/js\/dist\//u.test(value.pathname));
    });
    expect(avoidable, `${path} avoidable requests`).toEqual([]);
    page.off('request', collect);
  }
  expect(runtimeErrors).toEqual([]);
});

test('analysis keeps full-site data on demand and uses an immutable file', async ({ page }) => {
  const dataRequests = [];
  page.on('request', request => {
    if (request.url().includes('/data/v2/')) dataRequests.push(request.url());
  });
  await page.goto('/analysis.html');
  await expect(page.locator('.metric-card')).toHaveCount(8);
  await expect(page).toHaveURL(/\/analysis\.html$/u);
  expect(dataRequests).toEqual([]);
  await page.locator('[data-scope="all"]').click();
  await expect(page.locator('[data-scope="all"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#resultCount')).toContainText(/\d/u);
  expect(dataRequests).toHaveLength(1);
  expect(dataRequests[0]).toMatch(/analysis-current\.[a-f0-9]{16}\.json$/u);
});

test('rankings switch hot platforms without data and fetch hashed secondary charts', async ({ page }) => {
  const dataRequests = [];
  page.on('request', request => {
    if (request.url().includes('/data/')) dataRequests.push(request.url());
  });
  await page.goto('/rankings.html');
  const expected = await page.locator('#ttmrank-bootstrap').evaluate(node => {
    const rankings = JSON.parse(node.textContent).rankings;
    return {
      androidHot: rankings.meta.platforms.android.hot.count,
      iosHot: rankings.meta.platforms.ios.hot.count,
      androidSell: rankings.meta.platforms.android.sell.count,
    };
  });
  await expect(page.locator('.game-card')).toHaveCount(expected.androidHot);
  await expect(page.locator('.game-card .rank').nth(0)).toHaveText('1');
  await expect(page.locator('.game-card .rank').nth(1)).toHaveText('2');
  await page.getByRole('button', { name: 'iOS' }).click();
  await expect(page.locator('.game-card')).toHaveCount(expected.iosHot);
  await expect(page.locator('.game-card .rank').nth(0)).toHaveText('1');
  await expect(page.locator('.game-card .rank').nth(1)).toHaveText('2');
  expect(dataRequests).toEqual([]);
  await page.getByRole('button', { name: 'Android' }).click();
  await page.locator('#tabs [data-key="sell"]').click();
  await expect(page.locator('.game-card')).toHaveCount(expected.androidSell);
  expect(dataRequests).toHaveLength(1);
  expect(dataRequests[0]).toMatch(/rankings-android-sell\.[a-f0-9]{16}\.json$/u);
});

test('optimized analysis and rankings remain overflow-free at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ['/analysis.html', '/rankings.html']) {
    await page.goto(path);
    const dimensions = await page.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scroll).toBe(dimensions.client);
  }
});

test('game map defaults to lightweight rendering and loads Three only on explicit enhancement', async ({ page }) => {
  const requests = [];
  page.on('request', request => requests.push(request.url()));
  await page.goto('/universe.html');
  await expect(page.locator('#universeStage')).toHaveAttribute('data-render-mode', 'static');
  expect(requests.some(url => url.includes('universe-three.js'))).toBe(false);
  await page.getByRole('link', { name: '启用增强地图' }).click();
  await expect(page).toHaveURL(/render=webgl/u);
  await expect(page.locator('#universeStage')).toHaveAttribute('data-render-mode', 'webgl');
  expect(requests.some(url => url.includes('universe-three.js'))).toBe(true);
});

test('complete changes loads only the selected immutable slice after user intent', async ({ page }) => {
  const requests = [];
  page.on('request', request => {
    if (request.url().includes('/data/v2/changes-')) requests.push(request.url());
  });
  await page.goto('/changes.html');
  await expect(page.locator('#changesFeed')).toBeVisible();
  expect(requests).toEqual([]);
  await page.locator('[data-range="7d"]').click();
  await expect(page).toHaveURL(/range=7d/u);
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toMatch(/changes-7d-made\.[a-f0-9]{16}\.json$/u);
});
