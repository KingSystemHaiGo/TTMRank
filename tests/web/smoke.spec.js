import { test, expect } from '@playwright/test';

test('concise home routes to game analysis and preserved rankings', async ({ page }) => {
  await page.goto('/index.html');
  await expect(page).toHaveTitle(/TTMRank/);
  await expect(page.getByRole('link', { name: /进入游戏分析/ })).toHaveAttribute('href', 'analysis.html?scope=made');
  await expect(page.getByRole('link', { name: /浏览原始排行榜/ })).toHaveAttribute('href', 'rankings.html');
  await expect(page.getByRole('link', { name: '厂商核实' })).toHaveCount(0);
  await expect(page.locator('#makerCount')).not.toHaveText('—');
  await expect(page.locator('.home-grid')).toHaveCount(0);
  await expect(page.locator('.snapshot article')).toHaveCount(3);
});

test('concise home fits the primary mobile experience in one viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/index.html');
  const layout = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
    viewportHeight: window.innerHeight,
    secondLineCount: document.querySelector('.home-hero h1 em')?.getClientRects().length,
    snapshotColumns: getComputedStyle(document.querySelector('.snapshot')).gridTemplateColumns.split(' ').length,
  }));
  expect(layout.scrollWidth).toBe(layout.width);
  expect(layout.scrollHeight).toBeLessThanOrEqual(layout.viewportHeight);
  expect(layout.secondLineCount).toBe(1);
  expect(layout.snapshotColumns).toBe(3);
});

test('preserved ranking browser starts with ranks one and two visible', async ({ page }) => {
  await page.goto('/rankings.html');
  await expect(page.getByRole('heading', { name: '原始排行榜' })).toBeVisible();
  await expect(page.locator('#platBar')).not.toBeEmpty();
  const cards = page.locator('.game-card');
  await expect(cards).toHaveCount(150);
  await expect(cards.nth(0).locator('.rank')).toHaveText('1');
  await expect(cards.nth(1).locator('.rank')).toHaveText('2');
  await expect(cards.nth(0)).toBeVisible();
  await expect(cards.nth(1)).toBeVisible();
  const searchBox = await page.locator('.search-shell').boundingBox();
  const firstBox = await cards.nth(0).boundingBox();
  expect(firstBox.y).toBeGreaterThanOrEqual(searchBox.y + searchBox.height - 1);
  await cards.nth(0).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#gameModalBg')).toHaveClass(/show/);
  await expect(page.locator('#gameModalBg')).toHaveJSProperty('open', true);
  await expect(page.locator('#gameModal')).toContainText('开发 / 发行');
  await expect(page.locator('.gm-close')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('.gm-link')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('.gm-close')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#gameModalBg')).not.toHaveClass(/show/);
  await expect(cards.nth(0)).toBeFocused();
  await page.locator('#searchInput').focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('#searchInput')).toBeFocused();
});

test('ranking controls retain keyboard focus after changing data', async ({ page }) => {
  await page.goto('/rankings.html');
  const ios = page.getByRole('button', { name: 'iOS' });
  await ios.click();
  await expect(ios).toBeFocused();
  const sell = page.locator('#tabs [data-key="sell"]');
  await sell.click();
  await expect(page.locator('#tabs [data-key="sell"]')).toBeFocused();
});

test('rankings have no mobile page overflow', async ({ page }) => {
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/rankings.html');
    await expect(page.locator('.game-card').first()).toBeVisible();
    const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    expect(dimensions.scroll).toBe(dimensions.width);
  }
});

test('retired vendor route redirects to game analysis', async ({ page }) => {
  await page.goto('/vendors.html');
  await expect(page).toHaveURL(/analysis\.html\?scope=made/);
  await expect(page.getByRole('heading', { name: /从游戏表现中/ })).toBeVisible();
});

test('analysis page loads real v2 data and game icons', async ({ page }) => {
  const requested = [];
  await page.route(/https:\/\/[^/]*tapimg\.com\//, route => route.fulfill({
    status: 200,
    contentType: 'image/png',
    headers: { 'access-control-allow-origin': '*' },
    body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
  }));
  page.on('request', request => requested.push(request.url()));
  await page.goto('/analysis.html?scope=made');
  await expect(page.getByText('从游戏表现中', { exact: false })).toBeVisible();
  await expect(page.locator('.metric-card')).toHaveCount(8);
  await expect(page.locator('.metric-primary')).toHaveCount(4);
  await expect(page.locator('.metric-supporting')).toHaveCount(4);
  await expect(page.locator('.board')).toHaveCount(13);
  await expect(page.locator('.opportunity-row')).toHaveCount(6);
  await expect(page.locator('.signal-game').first()).toBeVisible();
  await expect(page.locator('.opportunity-head p')).toContainText('全站范围只作同屏参考');
  await expect(page.locator('.formula-note')).toContainText('综合表现');
  await expect(page.locator('#profileSelect')).toHaveCount(0);
  await expect(page.getByText('个人适配')).toHaveCount(0);
  await expect(page.getByRole('link', { name: '厂商核实' })).toHaveCount(0);
  await expect(page.locator('#heatChart')).toHaveAttribute('role', 'img');
  await expect(page.locator('#heatChart')).toHaveAttribute('aria-label', /热度分布直方图/);
  await expect(page.locator('#heatChart .histogram-column')).toHaveCount(12);
  await expect(page.locator('#scatterChart')).toHaveAttribute('aria-label', /评分与热度散点图/);
  await expect(page.locator('#scatterChart svg')).toBeVisible();
  expect(requested.some(url => /echarts/i.test(url))).toBe(false);
  const icons = page.locator('.game-icon');
  await expect(icons.first()).toBeVisible();
  await expect.poll(async () => icons.first().evaluate(image => image.naturalWidth)).toBeGreaterThan(0);
  await expect(icons.first()).toHaveAttribute('referrerpolicy', 'no-referrer');
  await expect(page.locator('.export-menu summary')).toBeVisible();
  await page.locator('.export-menu summary').click();
  await expect(page.locator('#imageBtn')).toBeVisible();
  const manifest = await page.evaluate(() => fetch('data/v2/manifest.json').then(response => response.json()));
  if (manifest.history_available) {
    await expect(page.locator('#qualityBanner')).not.toContainText('近期增量暂不可用');
  } else {
    await expect(page.locator('#qualityBanner')).toContainText('近期增量暂不可用');
  }
  await page.locator('.game-row').first().click();
  await expect(page.locator('#drawerContent')).toContainText('近 24 小时增长');
  await expect(page.locator('#drawerContent')).not.toContainText('厂商规模');
  await expect(page.locator('#drawerContent')).not.toContainText('账号角色');
  if (manifest.history_available) {
    await expect(page.locator('#drawerContent')).not.toContainText('历史暂不可用');
  } else {
    await expect(page.locator('#drawerContent')).toContainText('历史暂不可用');
  }
});
