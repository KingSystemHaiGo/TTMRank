import { test, expect } from '@playwright/test';

test('existing ranking page loads', async ({ page }) => {
  await page.goto('/index.html');
  await expect(page).toHaveTitle(/TTMRank/);
});

test('analysis page loads real v2 data and game icons', async ({ page }) => {
  await page.goto('/analysis.html?scope=made');
  await expect(page.getByText('排行榜数据', { exact: false })).toBeVisible();
  await expect(page.locator('.metric-card')).toHaveCount(8);
  await expect(page.locator('.board')).toHaveCount(13);
  const icons = page.locator('.game-icon');
  await expect(icons.first()).toBeVisible();
  await expect.poll(async () => icons.first().evaluate(image => image.naturalWidth)).toBeGreaterThan(0);
  await expect(icons.first()).toHaveAttribute('referrerpolicy', 'no-referrer');
  await expect(page.locator('#imageBtn')).toBeVisible();
  await expect(page.locator('#qualityBanner')).toContainText('近期增量暂不可用');
});
