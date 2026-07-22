import { test, expect } from '@playwright/test';

async function openAnalysis(page, query = '') {
  await page.goto(`/analysis.html${query}`);
  await expect(page.locator('.metric-card')).toHaveCount(8);
  await expect(page.locator('.board')).toHaveCount(13);
}

test('scope, platform, ranking, tag and hour-level release filters update URL and results', async ({ page }) => {
  await openAnalysis(page);
  const initial = await page.locator('#resultCount').textContent();
  await page.locator('.quick-filter [data-scope="made"]').click();
  await page.locator('[data-platform="ios"]').click();
  await page.locator('#advancedBtn').click();
  await page.locator('#charts').selectOption(['hot', 'new']);
  await page.locator('#scoreMin').fill('8');
  await page.locator('#releasedFrom').fill('2026-07-01T12:30');
  await page.locator('#tags').fill('TapTap制造');
  await page.waitForTimeout(250);
  await expect(page).toHaveURL(/scope=made/);
  await expect(page).toHaveURL(/platform=ios/);
  await expect(page).toHaveURL(/charts=hot%2Cnew/);
  await expect(page).toHaveURL(/releasedFrom=/);
  await expect(page.locator('#resultCount')).not.toHaveText(initial);
  await page.locator('#resetBtn').click();
  await expect(page).toHaveURL(/scope=made/);
  await expect(page.locator('.quick-filter [data-scope="made"]')).toHaveAttribute('aria-pressed', 'true');
});

test('clear filters only appears after the default analysis state changes', async ({ page }) => {
  await openAnalysis(page, '?scope=made');
  const reset = page.locator('#resetBtn');
  await expect(reset).toBeHidden();

  await page.locator('[data-platform="ios"]').click();
  await expect(reset).toBeVisible();
  await expect(page).toHaveURL(/platform=ios/);

  await reset.click();
  await expect(reset).toBeHidden();
  await expect(page).not.toHaveURL(/platform=/);
  await expect(page.locator('[data-platform="all"]')).toHaveAttribute('aria-pressed', 'true');
});

test('fixed baseline, report mode and details drawer are interactive', async ({ page }) => {
  await openAnalysis(page, '?scope=made');
  await page.locator('#advancedBtn').click();
  await page.locator('#baseline').selectOption('fixed');
  await page.waitForTimeout(250);
  await expect(page).toHaveURL(/baseline=fixed/);
  await expect(page.locator('#reportMeta')).toContainText('固定');

  await page.locator('#reportBtn').click();
  await expect(page.locator('body')).toHaveClass(/report-mode/);
  await expect(page.locator('#reportBtn')).toContainText('返回');

  await page.locator('#reportBtn').click();
  const row = page.locator('.game-row').first();
  await row.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#drawerBg')).toHaveClass(/show/);
  await expect(page.locator('#drawerBg')).toHaveJSProperty('open', true);
  await expect(page.locator('#drawerClose')).toBeFocused();
  await expect(page.locator('#drawerContent h2')).not.toBeEmpty();
  await expect(page.locator('#drawerContent')).toContainText('近 24 小时增长');
  await expect(page.locator('#drawerContent')).not.toContainText('查看详情');
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#drawerContent a')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('#drawerClose')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#drawerBg')).not.toHaveClass(/show/);
  await expect(row).toBeFocused();
});

test('type signals drill down to representative game details', async ({ page }) => {
  await openAnalysis(page, '?scope=made');
  const game = page.locator('.signal-game').first();
  const title = await game.textContent();
  await game.click();
  await expect(page.locator('#drawerBg')).toHaveJSProperty('open', true);
  await expect(page.locator('#drawerContent h2')).toHaveText(title);
  await expect(page.locator('#drawerClose')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(game).toBeFocused();
});

test('mobile layout keeps game scope switching and type rows inside the viewport', async ({ page }) => {
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 800 });
    await openAnalysis(page, '?scope=made');
    const scope = page.locator('.mobile-scope');
    await expect(scope).toBeVisible();
    const all = scope.locator('[data-scope="all"]');
    await all.click();
    await expect(all).toHaveAttribute('aria-pressed', 'true');
    await expect(page).toHaveURL(/scope=all/);
    const dimensions = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
      typeScroll: document.querySelector('#typeList')?.scrollWidth,
      typeWidth: document.querySelector('#typeList')?.clientWidth,
      signalGameHeight: document.querySelector('.signal-game')?.getBoundingClientRect().height,
    }));
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width);
    expect(dimensions.typeScroll).toBeLessThanOrEqual(dimensions.typeWidth);
    expect(dimensions.signalGameHeight).toBeGreaterThanOrEqual(32);
  }
});

test('long-image export splits canvases above the browser-safe height', async ({ page }) => {
  await page.addInitScript(() => {
    window.__downloads = [];
    const nativeClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function click() {
      if (this.download) window.__downloads.push(this.download);
      else nativeClick.call(this);
    };
  });
  await openAnalysis(page, '?scope=made');
  await page.locator('.export-menu summary').click();
  await page.evaluate(() => {
    window.html2canvas = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 100;
      canvas.height = 15001;
      return canvas;
    };
  });
  await page.locator('#imageBtn').click();
  await expect.poll(() => page.evaluate(() => window.__downloads.length), { timeout: 15000 }).toBe(2);
  const downloads = await page.evaluate(() => window.__downloads);
  expect(downloads[0]).toMatch(/1of2\.png$/);
  expect(downloads[1]).toMatch(/2of2\.png$/);
  await expect(page.locator('#imageBtn')).toBeEnabled();
});
