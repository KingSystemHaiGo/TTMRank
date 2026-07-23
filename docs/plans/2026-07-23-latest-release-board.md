# 最新发布小榜单 Implementation Plan

> **For implementer:** Use TDD throughout. Write failing test first. Watch it fail. Then implement.

**Goal:** 在保留“近两周上新 TOP15”的同时，为游戏分析页增加按真实发布时间倒序的独立小榜单。

**Architecture:** 从现有筛选结果中纯函数选出最近发布的 6 款游戏，再由现有 DOM 工具渲染为可点击的紧凑列表。复用分析数据、游戏图标和详情抽屉，不增加请求或运行时依赖。

**Tech Stack:** Vanilla JavaScript ES modules, HTML, CSS, Node test runner, Playwright.

---

### Task 1: 最新发布选择器

**Files:**
- Modify: `app/js/analysis/boards.js`
- Test: `tests/web/boards.test.js`

1. 添加失败测试，断言游戏按 `released_at`、热度和 ID 稳定排序，并排除未来及无效发布时间。
2. 运行 `node --test tests/web/boards.test.js`，确认因缺少 `latestReleasedGames` 失败。
3. 实现 `latestReleasedGames(games, observedAt, limit)`，默认最多返回 6 款。
4. 再次运行目标测试并确认通过。

### Task 2: 页面渲染与筛选联动

**Files:**
- Modify: `app/analysis.html`
- Modify: `app/js/analysis/app.js`
- Modify: `app/js/analysis/table.js`
- Modify: `app/css/analysis.css`
- Test: `tests/web/smoke.spec.js`
- Test: `tests/web/analysis-interactions.spec.js`

1. 先添加浏览器断言：新榜单可见、原 `.board` 数量仍为 13、点击最新发布项能打开详情。
2. 在核心指标之后加入独立语义区域，渲染最多 6 个可点击游戏项和空状态。
3. 在每次现有 `render()` 执行时基于 `filtered.games` 重建列表，使其自动跟随 URL 与控件筛选。
4. 增加三列、两列、单列响应式样式，并更新静态资源版本号。

### Task 3: 回归与视觉验收

**Files:**
- Verify only

1. 运行 `npm run test:unit`。
2. 运行分析页相关 Playwright 测试，再运行完整 `npm run test:e2e`。
3. 启动本地静态站，在桌面与手机视口检查页面身份、内容加载、控制台、交互、横向溢出与截图。
4. 确认工作树只包含本功能文件后提交。
