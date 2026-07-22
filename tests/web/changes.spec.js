import { test, expect } from '@playwright/test';

const GENERATED_AT = 2_000_000;
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function change(overrides = {}) {
  return {
    id: 'evt_rank_rise',
    kind: 'rank_rise',
    scope: 'made',
    game_id: 1,
    game_title: '星火之歌',
    game_icon: PIXEL,
    game_url: 'https://www.taptap.cn/app/1',
    platform: 'android',
    chart: 'hot',
    before: 18,
    after: 9,
    observed_at: GENERATED_AT - 300,
    first_observed_at: GENERATED_AT - 300,
    last_observed_at: GENERATED_AT - 300,
    occurrences: 1,
    importance: 92,
    rule: 'rank_threshold_11_50',
    ...overrides,
  };
}

const READY_FEED = {
  schema_version: '1.0',
  generated_at: GENERATED_AT,
  updated_at: '2026-07-22 12:00:00',
  status: 'ready',
  comparison_available: true,
  partial: false,
  suppressed_negative_event_count: 0,
  events: [
    change(),
    change({ id: 'evt_score', kind: 'score_fall', game_id: 2, game_title: '雾境回声', before: 8.2, after: 8.0, platform: null, chart: null, importance: 80, observed_at: GENERATED_AT - 1_800, first_observed_at: GENERATED_AT - 1_800, last_observed_at: GENERATED_AT - 1_800 }),
    change({ id: 'evt_enter', kind: 'entered', game_id: 3, game_title: '远潮', before: null, after: 12, platform: 'ios', chart: 'new', importance: 76, observed_at: GENERATED_AT - 7_200, first_observed_at: GENERATED_AT - 7_200, last_observed_at: GENERATED_AT - 7_200 }),
    change({ id: 'evt_coverage', kind: 'coverage_increase', game_id: 4, game_title: '纸上城', before: 1, after: 3, platform: null, chart: null, importance: 72, observed_at: GENERATED_AT - 10_000, first_observed_at: GENERATED_AT - 10_000, last_observed_at: GENERATED_AT - 10_000 }),
    change({ id: 'evt_reenter', kind: 'reentered', game_id: 5, game_title: '昼夜航线', before: null, after: 8, platform: 'android', chart: 'sell', importance: 70, observed_at: GENERATED_AT - 14_000, first_observed_at: GENERATED_AT - 14_000, last_observed_at: GENERATED_AT - 14_000 }),
    change({ id: 'evt_rank_fall', kind: 'rank_fall', scope: 'all', game_id: 6, game_title: '全站参考游戏', before: 5, after: 13, importance: 88, observed_at: GENERATED_AT - 20_000, first_observed_at: GENERATED_AT - 20_000, last_observed_at: GENERATED_AT - 20_000 }),
    change({ id: 'evt_exit', kind: 'exited', game_id: 7, game_title: '旧日信号', before: 6, after: null, platform: 'ios', chart: 'hot', importance: 78, observed_at: GENERATED_AT - 2 * 86_400, first_observed_at: GENERATED_AT - 2 * 86_400, last_observed_at: GENERATED_AT - 2 * 86_400 }),
  ],
};

const MANIFEST = {
  schema_version: '2.0',
  updated_at: READY_FEED.updated_at,
  analysis_file: 'analysis-current.json',
  changes_file: 'changes-current.json',
  game_count: 887,
  appearance_count: 1655,
};

const ANALYSIS = {
  schema_version: '2.0',
  observed_at: GENERATED_AT,
  games: [
    { id: 1, title: '星火之歌', is_taptap_made: true },
    { id: 2, title: '雾境回声', is_taptap_made: true },
    { id: 3, title: '远潮', is_taptap_made: false },
  ],
};

async function mockData(page, feed = READY_FEED, { changesStatus = 200 } = {}) {
  await page.route('**/data/v2/manifest.json', route => route.fulfill({ json: MANIFEST }));
  await page.route('**/data/v2/analysis-current.json', route => route.fulfill({ json: ANALYSIS }));
  await page.route('**/data/v2/changes-current.json', route => route.fulfill(
    changesStatus === 200 ? { json: feed } : { status: changesStatus, body: 'unavailable' },
  ));
}

test('home opens with the latest 24 hours and no more than five important changes', async ({ page }) => {
  await mockData(page);
  await page.goto('/index.html');

  await expect(page).toHaveTitle(/TTMRank/);
  await expect(page.getByRole('heading', { name: 'TapTap制造游戏变化' })).toBeVisible();
  await expect(page.getByText('先看游戏', { exact: false })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '最近24小时' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.change-row')).toHaveCount(5);
  await expect(page.locator('.change-row').first()).toContainText('从第18名升至第9名');
  await expect(page.getByRole('link', { name: '查看全部变化' })).toHaveAttribute('href', 'changes.html');
});

test('home range switching updates rows, URL, and complete-feed destination', async ({ page }) => {
  await mockData(page);
  await page.goto('/index.html');

  await page.getByRole('button', { name: '最近1小时' }).click();
  await expect(page).toHaveURL(/range=1h/);
  await expect(page.locator('.change-row')).toHaveCount(2);
  await expect(page.getByRole('link', { name: '查看全部变化' })).toHaveAttribute('href', 'changes.html?range=1h');

  await page.getByRole('button', { name: '最近7天' }).click();
  await expect(page).toHaveURL(/range=7d/);
  await expect(page.locator('.change-row')).toHaveCount(5);
});

test('complete feed filters URL state and only shows clear when needed', async ({ page }) => {
  await mockData(page);
  await page.goto('/changes.html');

  await expect(page.getByRole('heading', { name: '全部游戏变化' })).toBeVisible();
  await expect(page.getByRole('button', { name: '清除筛选' })).toBeHidden();
  await page.getByLabel('变化类型').selectOption('score');
  await expect(page).toHaveURL(/type=score/);
  await expect(page.locator('.change-row')).toHaveCount(1);
  await expect(page.getByRole('button', { name: '清除筛选' })).toBeVisible();
  await page.getByRole('button', { name: '清除筛选' }).click();
  await expect(page).not.toHaveURL(/type=/);
  await expect(page.getByRole('button', { name: '清除筛选' })).toBeHidden();
});

test('desktop event detail uses a right drawer, URL history, and copy feedback', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async value => { window.__copied = value; } },
    });
  });
  await mockData(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/changes.html');
  await page.locator('.change-row').first().click();

  await expect(page).toHaveURL(/event=evt_rank_rise/);
  const detail = page.locator('.change-detail');
  await expect(detail).toBeVisible();
  const box = await detail.boundingBox();
  expect(box.x).toBeGreaterThan(700);
  expect(box.x + box.width).toBeCloseTo(1440, 0);
  await expect(detail).toContainText('从第18名升至第9名');
  await page.getByRole('button', { name: '复制变化链接' }).click();
  await expect(page.getByText('链接已复制')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__copied)).toContain('event=evt_rank_rise');

  await page.goBack();
  await expect(detail).toBeHidden();
  await expect(page).not.toHaveURL(/event=/);
});

test('mobile event detail fills the viewport and Back restores the feed', async ({ page }) => {
  await mockData(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/changes.html?range=7d');
  await page.locator('.change-row').nth(5).scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => window.scrollY);
  await page.locator('.change-row').nth(5).click();

  const detail = page.locator('.change-detail');
  const box = await detail.boundingBox();
  expect(box.x).toBe(0);
  expect(box.y).toBe(0);
  expect(box.width).toBe(390);
  expect(box.height).toBe(844);
  await page.goBack();
  await expect(detail).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThanOrEqual(before - 2);
});

test('baseline, ready-empty, partial, and hard-error states use specific copy', async ({ page }) => {
  const states = [
    [{ ...READY_FEED, status: 'baseline', comparison_available: false, events: [] }, '正在建立历史比较，下一次采集后开始记录变化'],
    [{ ...READY_FEED, events: [] }, '这段时间没有达到记录阈值的变化'],
    [{ ...READY_FEED, status: 'partial', partial: true, suppressed_negative_event_count: 2 }, '本轮采集不完整，已暂停生成跌出榜单和覆盖减少事件。'],
  ];
  for (const [feed, copy] of states) {
    await page.unrouteAll({ behavior: 'wait' });
    await mockData(page, feed);
    await page.goto('/index.html');
    await expect(page.getByText(copy, { exact: false })).toBeVisible();
  }

  await page.unrouteAll({ behavior: 'wait' });
  await mockData(page, READY_FEED, { changesStatus: 500 });
  await page.goto('/index.html');
  await expect(page.getByText('暂时无法读取变化数据')).toBeVisible();
  await expect(page.getByRole('button', { name: '重新读取' })).toBeVisible();
});

test('home and complete feed avoid page-level overflow at supported widths', async ({ page }) => {
  await mockData(page);
  for (const width of [1440, 1024, 390, 360]) {
    await page.setViewportSize({ width, height: width > 500 ? 900 : 800 });
    for (const path of ['/index.html', '/changes.html']) {
      await page.goto(path);
      const dimensions = await page.evaluate(() => ({
        client: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
      }));
      expect(dimensions.scroll, `${path} at ${width}px`).toBe(dimensions.client);
    }
  }
});
