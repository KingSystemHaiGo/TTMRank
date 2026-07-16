import { test, expect } from '@playwright/test';

test('concise home routes to Maker analysis and preserved rankings', async ({ page }) => {
  await page.goto('/index.html');
  await expect(page).toHaveTitle(/TTMRank/);
  await expect(page.getByRole('link', { name: /进入制造分析/ })).toHaveAttribute('href', 'analysis.html?scope=made');
  await expect(page.getByRole('link', { name: /浏览原始排行榜/ })).toHaveAttribute('href', 'rankings.html');
  await expect(page.locator('#makerCount')).not.toHaveText('—');
});

test('preserved ranking browser loads independently', async ({ page }) => {
  await page.goto('/rankings.html');
  await expect(page.getByRole('heading', { name: '原始排行榜' })).toBeVisible();
  await expect(page.locator('#platBar')).not.toBeEmpty();
  await expect(page.locator('.game-card').first()).toBeVisible();
  await page.locator('.game-card').first().focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#gameModalBg')).toHaveClass(/show/);
  await expect(page.locator('#gameModalBg')).toHaveJSProperty('open', true);
  await expect(page.locator('#gameModal')).toContainText('厂商 / 账号');
  await expect(page.locator('.gm-close')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('.gm-link')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('.gm-close')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#gameModalBg')).not.toHaveClass(/show/);
  await expect(page.locator('.game-card').first()).toBeFocused();
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

test('rankings and vendor workbench have no mobile page overflow', async ({ page }) => {
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    for (const path of ['/rankings.html', '/vendors.html']) {
      await page.goto(path);
      await expect(page.locator(path.includes('vendors') ? '.vendor-row' : '.game-card').first()).toBeVisible();
      const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
      expect(dimensions.scroll).toBe(dimensions.width);
    }
  }
});

test('vendor registry exposes verification coverage and Maker pending queue', async ({ page }) => {
  const requested = [];
  page.on('request', request => requested.push(request.url()));
  await page.goto('/vendors.html');
  await expect(page.getByRole('heading', { name: '厂商核实工作台' })).toBeVisible();
  await expect(page.locator('.vendor-metric')).toHaveCount(5);
  await expect(page.locator('.vendor-row').first()).toBeVisible();
  await expect(page.locator('.queue-pills')).toHaveAttribute('role', 'group');
  await expect(page.locator('#vendorCount')).toHaveAttribute('role', 'status');
  await expect(page.locator('#vendorList')).not.toHaveAttribute('aria-live', /.+/);
  const makerPending = page.locator('[data-queue="maker_pending"]');
  await makerPending.click();
  await expect(makerPending).toBeFocused();
  await expect(makerPending).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#vendorCount')).not.toHaveText('0 / 576');
  await expect(page.locator('.vendor-row').first()).toContainText('制造样本');
  const all = page.locator('[data-queue="all"]');
  await all.click();
  await expect(all).toBeFocused();
  const more = page.locator('.vendor-more');
  await expect(more).toBeVisible();
  await more.click();
  await expect(page.locator('.vendor-more')).toBeFocused();
  expect(requested.some(url => url.includes('analysis-current.json'))).toBe(false);
});

test('analysis page loads real v2 data and game icons', async ({ page }) => {
  const requested = [];
  page.on('request', request => requested.push(request.url()));
  await page.goto('/analysis.html?scope=made');
  await expect(page.getByText('从制造者样本中', { exact: false })).toBeVisible();
  await expect(page.locator('.metric-card')).toHaveCount(8);
  await expect(page.locator('.board')).toHaveCount(13);
  await expect(page.locator('.opportunity-row')).toHaveCount(6);
  await expect(page.locator('.formula-note')).toContainText('样本稀缺');
  await expect(page.locator('.formula-note')).not.toContainText('供给稀缺');
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
  await expect(page.locator('#imageBtn')).toBeVisible();
  const manifest = await page.evaluate(() => fetch('data/v2/manifest.json').then(response => response.json()));
  if (manifest.history_available) {
    await expect(page.locator('#qualityBanner')).not.toContainText('近期增量暂不可用');
  } else {
    await expect(page.locator('#qualityBanner')).toContainText('近期增量暂不可用');
  }
  await page.locator('.game-row').first().click();
  await expect(page.locator('#drawerContent')).toContainText('近 24 小时增长');
  if (manifest.history_available) {
    await expect(page.locator('#drawerContent')).not.toContainText('历史暂不可用');
  } else {
    await expect(page.locator('#drawerContent')).toContainText('历史暂不可用');
  }
});
