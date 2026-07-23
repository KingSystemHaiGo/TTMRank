import { test, expect } from '@playwright/test';

const VISUAL = {
  schema_version: '1.0',
  updated_at: '2026-07-22 18:00:00',
  observed_at: 2_000_000,
  clusters: ['模拟', '休闲'],
  games: [
    { id: 1, title: '高热模拟', icon: '', url: 'https://www.taptap.cn/app/1', cluster: '模拟', tags: ['模拟'], heat: 1_000_000, score: 9, daily_heat: 10_000, growth_24h: 100, chart_coverage: 4, platform_coverage: 2 },
    { id: 2, title: '低热休闲', icon: '', url: 'https://www.taptap.cn/app/2', cluster: '休闲', tags: ['休闲'], heat: 1_000, score: 7, daily_heat: 50, growth_24h: -20, chart_coverage: 1, platform_coverage: 1 },
  ],
};

const CHANGE_FEED = {
  schema_version: '1.0',
  updated_at: '2026-07-22 18:00:00',
  generated_at: 2_000_000,
  status: 'ready',
  comparison_available: true,
  partial: false,
  suppressed_negative_event_count: 0,
  events: [
    { id: 'rise', kind: 'rank_rise', scope: 'made', game_id: 1, game_title: '高热模拟', before: 18, after: 9, platform: 'android', chart: 'hot', importance: 90, observed_at: 1_999_000, last_observed_at: 1_999_000 },
    { id: 'score', kind: 'score_fall', scope: 'made', game_id: 2, game_title: '低热休闲', before: 8.1, after: 7.9, platform: 'ios', chart: 'new', importance: 60, observed_at: 1_996_000, last_observed_at: 1_996_000 },
  ],
};

const MANIFEST = {
  schema_version: '2.0',
  updated_at: '2026-07-22 18:00:00',
  observed_at: 2_000_000,
  visual_file: 'visual-current.json',
  visual_sha256: 'a'.repeat(64),
  changes_file: 'changes-current.json',
  changes_sha256: 'b'.repeat(64),
  taptap_made_game_count: 2,
  game_count: 2,
  appearance_count: 2,
};

async function mockVisualData(page) {
  await page.route('**/data/v2/manifest.json*', route => route.fulfill({ json: MANIFEST }));
  await page.route('**/data/v2/visual-current.json*', route => route.fulfill({ json: VISUAL }));
}

async function mockChanges(page) {
  await page.route('**/data/v2/manifest.json*', route => route.fulfill({ json: MANIFEST }));
  await page.route('**/data/v2/changes-current.json*', route => route.fulfill({ json: CHANGE_FEED }));
}

test('home portal adds no Three, Pixi or visual-data request', async ({ page }) => {
  const requests = [];
  page.on('request', request => requests.push(request.url()));
  await mockChanges(page);
  await page.goto('/index.html');
  await expect(page.getByRole('link', { name: /打开游戏地图/ })).toBeVisible();
  expect(requests.some(url => /universe-three|change-map-pixi|visual-current/.test(url))).toBe(false);
});

test('flat game map renders with WebGL and preserves exact DOM details', async ({ page }) => {
  await mockVisualData(page);
  await page.goto('/universe.html?render=webgl');
  await expect(page.locator('#universeStage')).toHaveAttribute('data-render-mode', 'webgl');
  await expect(page.locator('#universeCanvas')).toHaveAttribute('data-render-ready', 'true');
  await expect(page.locator('.universe-marker')).toHaveCount(2);
  await expect(page.getByRole('heading', { name: 'TapTap制造游戏地图' })).toBeVisible();
  await expect(page.locator('#universePause')).toHaveCount(0);
  await expect(page.locator('#universeReset')).toHaveCount(0);
  await expect(page.locator('#universeStage')).toHaveCSS('background-color', 'rgb(246, 248, 248)');
  await page.locator('.universe-game-row[data-game-id="1"]').click();
  await expect(page.locator('#universeDetail')).toContainText('100.0万');
  await expect(page).toHaveURL(/game=1/);
});

test('choosing a type removes empty lanes and reuses the map height', async ({ page }) => {
  await mockVisualData(page);
  await page.goto('/universe.html?render=static');
  const initialHeight = await page.locator('#universeStage').evaluate(node => node.getBoundingClientRect().height);
  await page.getByRole('button', { name: '模拟类型，共1款' }).click();
  await expect(page.locator('.universe-lane-label')).toHaveCount(1);
  await expect(page.locator('.universe-marker')).toHaveCount(1);
  const focusedHeight = await page.locator('#universeStage').evaluate(node => node.getBoundingClientRect().height);
  expect(focusedHeight).toBeLessThan(initialHeight);
});

test('default lightweight universe never downloads Three.js', async ({ page }) => {
  const requests = [];
  page.on('request', request => requests.push(request.url()));
  await mockVisualData(page);
  await page.goto('/universe.html');
  await expect(page.locator('#universeStage')).toHaveAttribute('data-render-mode', 'static');
  await expect(page.locator('.universe-marker')).toHaveCount(2);
  expect(requests.some(url => url.includes('universe-three.js'))).toBe(false);
});

test('Pixi is lazy, renders only in map view and is destroyed on list return', async ({ page }) => {
  const pixiRequests = [];
  page.on('request', request => {
    if (request.url().includes('change-map-pixi.js')) pixiRequests.push(request.url());
  });
  await mockChanges(page);
  await page.goto('/changes.html');
  await expect(page.locator('.change-map-canvas')).toHaveCount(0);
  expect(pixiRequests).toHaveLength(0);

  await page.getByRole('button', { name: '变化图谱' }).click();
  await expect(page.locator('.change-map-canvas')).toHaveAttribute('data-render-ready', 'true');
  expect(pixiRequests).toHaveLength(1);
  await expect(page).toHaveURL(/view=map/);

  await page.getByRole('button', { name: '列表', exact: true }).click();
  await expect(page.locator('.change-map-canvas')).toHaveCount(0);
  await expect(page.locator('#changeMapCanvas')).toHaveAttribute('data-map-destroyed', 'true');
  await expect(page).not.toHaveURL(/view=map/);
});

test('save-data map mode keeps the DOM path and never downloads Pixi', async ({ page }) => {
  const pixiRequests = [];
  page.on('request', request => {
    if (request.url().includes('change-map-pixi.js')) pixiRequests.push(request.url());
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'connection', { configurable: true, value: { saveData: true } });
  });
  await mockChanges(page);
  await page.goto('/changes.html?view=map');
  await expect(page.locator('#changeMapState')).toContainText('未加载图谱引擎');
  await expect(page.locator('#changeMapEvents .change-row')).toHaveCount(2);
  expect(pixiRequests).toHaveLength(0);
});

test('visual pages avoid horizontal overflow at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockVisualData(page);
  await page.goto('/universe.html?render=static');
  await expect(page.locator('.universe-marker')).toHaveCount(2);
  let width = await page.evaluate(() => [document.documentElement.clientWidth, document.documentElement.scrollWidth]);
  expect(width[1]).toBe(width[0]);

  await page.unrouteAll({ behavior: 'wait' });
  await mockChanges(page);
  await page.goto('/changes.html?view=map');
  await expect(page.locator('.change-map-canvas')).toHaveAttribute('data-render-ready', 'true');
  width = await page.evaluate(() => [document.documentElement.clientWidth, document.documentElement.scrollWidth]);
  expect(width[1]).toBe(width[0]);
});
