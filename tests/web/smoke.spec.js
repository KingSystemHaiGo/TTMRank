import { test, expect } from '@playwright/test';

test('existing ranking page loads', async ({ page }) => {
  await page.goto('/index.html');
  await expect(page).toHaveTitle(/TTMRank/);
});
