import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const FULL_ANALYSIS = JSON.parse(readFileSync(new URL('../../app/data/v2/analysis-current.json', import.meta.url), 'utf8'));
const MADE_IDS = new Set(FULL_ANALYSIS.games.filter(game => game.is_taptap_made).map(game => game.id));
const MADE_ANALYSIS = {
  ...FULL_ANALYSIS,
  games: FULL_ANALYSIS.games.filter(game => MADE_IDS.has(game.id)),
  appearances: FULL_ANALYSIS.appearances.filter(row => MADE_IDS.has(row.game_id)),
  metrics: FULL_ANALYSIS.metrics.filter(metric => MADE_IDS.has(metric.game_id)).map(metric => ({
    ...metric,
    heat_delta_1h: 100,
    heat_delta_1h_estimated: true,
    heat_delta_1h_basis_hours: 2,
  })),
};

async function openAnalysis(page, query = '') {
  await page.goto(`/analysis.html${query}`);
  await expect(page.locator('.metric-card')).toHaveCount(8);
  await expect(page.locator('.board')).toHaveCount(13);
}

test('made data renders before quality and all-site data loads only after scope switch', async ({ page }) => {
  const requests = [];
  let pendingQuality = null;
  page.on('request', request => requests.push(request.url()));
  await page.route('**/data/v2/manifest.json*', route => route.fulfill({ json: {
    schema_version: '2.0',
    updated_at: FULL_ANALYSIS.updated_at,
    observed_at: FULL_ANALYSIS.observed_at,
    analysis_file: 'analysis-current.json',
    analysis_sha256: 'a'.repeat(64),
    analysis_made_file: 'analysis-made-current.json',
    analysis_made_sha256: 'b'.repeat(64),
    quality_file: 'quality.json',
    quality_sha256: 'c'.repeat(64),
    history_windows: { '1h': true, '24h': true, '7d': true },
  } }));
  await page.route('**/data/v2/analysis-made-current.json*', route => route.fulfill({ json: MADE_ANALYSIS }));
  await page.route('**/data/v2/analysis-current.json*', route => route.fulfill({ json: FULL_ANALYSIS }));
  await page.route('**/data/v2/quality.json*', route => { pendingQuality = route; });

  await page.goto('/analysis.html?scope=made');
  await expect(page.locator('.metric-card')).toHaveCount(8);
  await expect.poll(() => Boolean(pendingQuality)).toBe(true);
  expect(requests.some(url => url.includes('/js/dist/analysis-app.js'))).toBe(true);
  expect(requests.some(url => url.includes('/js/analysis/boards.js'))).toBe(false);
  expect(requests.some(url => url.includes('analysis-made-current.json'))).toBe(true);
  expect(requests.some(url => /\/analysis-current\.json/.test(url))).toBe(false);

  await page.locator('.game-row').first().click();
  const estimatedHour = page.locator('.detail-stat').filter({ hasText: '近 1 小时增长（估算）' });
  await expect(estimatedHour).toHaveCount(1);
  await expect(estimatedHour).toContainText('≈100');
  await expect(estimatedHour).toHaveAttribute('title', /最近 2/);
  await page.keyboard.press('Escape');

  await pendingQuality.fulfill({ json: { schema_version: '2.0', issues: [] } });
  const allScope = page.locator('[data-scope="all"]');
  await allScope.click();
  await expect(allScope).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => requests.some(url => /\/analysis-current\.json/.test(url))).toBe(true);
  await expect(page).toHaveURL(/scope=all/);
});

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

test('latest releases stay separate from existing boards, follow filters and open details', async ({ page }) => {
  await openAnalysis(page, '?scope=made');
  await expect(page.getByRole('heading', { name: '最新发布', exact: true })).toBeVisible();
  const releases = page.locator('.latest-release-item');
  await expect(releases).toHaveCount(6);
  await expect(page.locator('.board')).toHaveCount(13);

  const first = releases.first();
  const title = await first.locator('.latest-release-title').textContent();
  await page.locator('#query').fill(title);
  await page.waitForTimeout(250);
  await expect(page.locator('.latest-release-item')).toHaveCount(1);

  const filteredRelease = page.locator('.latest-release-item');
  await expect(filteredRelease).toHaveCSS('border-bottom-width', '1px');
  await filteredRelease.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#drawerBg')).toHaveJSProperty('open', true);
  await expect(page.locator('#drawerContent h2')).toHaveText(title);
  await page.keyboard.press('Escape');
  await expect(filteredRelease).toBeFocused();
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
