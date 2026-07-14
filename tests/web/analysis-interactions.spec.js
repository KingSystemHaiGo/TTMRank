import { test, expect } from '@playwright/test';

async function openAnalysis(page, query = '') {
  await page.goto(`/analysis.html${query}`);
  await expect(page.locator('.metric-card')).toHaveCount(8);
  await expect(page.locator('.board')).toHaveCount(13);
}

test('scope, platform, ranking, tag and hour-level release filters update URL and results', async ({ page }) => {
  await openAnalysis(page);
  const initial = await page.locator('#resultCount').textContent();
  await page.locator('[data-scope="made"]').click();
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
  await page.locator('.game-row').first().click();
  await expect(page.locator('#drawerBg')).toHaveClass(/show/);
  await expect(page.locator('#drawerContent h2')).not.toBeEmpty();
  await expect(page.locator('#drawerContent')).toContainText('近 24 小时增长');
  await page.keyboard.press('Escape');
  await expect(page.locator('#drawerBg')).not.toHaveClass(/show/);
});

test('mobile layout has no horizontal page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await openAnalysis(page, '?scope=made');
  const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width);
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
