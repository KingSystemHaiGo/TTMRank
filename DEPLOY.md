# TTMRank 部署指南

TTMRank 主站是 GitHub Pages 静态站点。源码保存在 Git；每次发布时由 Action
抓取最新 TapTap 数据、生成 `app/`、验证后直接上传 Pages artifact。变化比较
使用 Actions 滚动状态；近 1 小时、24 小时和 7 天热度基线由有界缓存逐步积累，
长期趋势与事件归档由可选的 Cloudflare D1 提供。

## 1. GitHub Pages

1. 在仓库 `Settings → Pages` 中选择 `GitHub Actions`。
2. 保持工作流可使用 `pages: write`、`id-token: write`；仓库内容权限只需
   `contents: read`。不再需要为了自动数据提交开放 `contents: write`。
3. 推送到 `main` 或 `master` 后，`Deploy to GitHub Pages` 会先抓取一份新
   数据，再运行 Python、JavaScript 和 Chromium 回归测试，然后上传 `app/`。
4. `Refresh Data` 每轮同样生成并验证数据，再直接部署 artifact；它不会
   执行 `git add`、`git commit` 或 `git push`。

两个发布工作流都会记录 artifact 对应的源码 SHA，并在部署前与默认分支最新
SHA 再次比较。过时的刷新 artifact 会跳过，而不是覆盖刚发布的新代码；代码
推送可以取消更旧的 Pages 发布。采集 job 上限为 30 分钟，Pages 部署上限为
10 分钟，避免卡住的发布长期阻塞刷新。

可选的生产主时钟使用独立 Cloudflare Cron Worker 每 20 分钟派发一次 `Refresh Data`。
刷新工作流不会 `sleep`、等待下一轮或自我派发，因此每次 Runner 只承担一轮
采集、校验和发布。部署步骤：

1. 复制 `cloudflare/wrangler.scheduler.toml.example` 为本地
   `cloudflare/wrangler.scheduler.toml`。
2. 创建 GitHub fine-grained token，只授予本仓库 Actions 读写权限；运行
   `npx wrangler secret put GITHUB_ACTIONS_TOKEN --config wrangler.scheduler.toml`。
3. 在 `cloudflare/` 运行
   `npx wrangler deploy --config wrangler.scheduler.toml`。

调度 Worker 不绑定 D1、不抓取 TapTap，只发送一次有 10 秒上限的 GitHub API
请求。部署并验证 Cloudflare Cron 之前，不要设置仓库变量
`TTMRANK_CLOUDFLARE_SCHEDULER_ACTIVE`；变量未设置时，三个 GitHub 计划入口仍按
原频率派发，合并代码不会造成停更。确认 Cloudflare 至少成功触发一次刷新后，将
变量设为 `true`，三个入口才切换为看门狗：仅当中央刷新超过 45 分钟没有启动时
补发。Cloudflare 健康时它们不会重复采集，也不进入网页加载链路。

采集失败不会部署空榜。最新线上快照存在 Pages deployment artifact 中，而
不是由定时任务写回 Git。工作流摘要会显示游戏数、榜单记录数、质量告警、
文件体积、小时历史基线、本轮 D1 摄入状态和变化事件归档状态。状态只显示
`success`、`failed` 或 `not_configured`，不会公开 URL、token 或异常详情。

## 2. 小时历史与图标代理（可选）

安装 Wrangler 后，在 `cloudflare/` 目录创建 D1 数据库并应用 schema：

```bash
npx wrangler d1 create ttmrank-history
npx wrangler d1 execute ttmrank-history --file schema.sql --remote
```

复制 `cloudflare/wrangler.toml.example` 为本地 `wrangler.toml`，填写 D1
`database_id`，不要提交真实 token。为 Worker 配置：

- `ALLOWED_ORIGINS`：例如 `https://kingsystemhaigo.github.io`。
- `INGEST_TOKEN`：高强度随机密钥。
- `MAINTENANCE_TOKEN`：另一把高强度随机密钥。

在 GitHub Actions secrets 中配置：

- `TTMRANK_HISTORY_URL`
- `TTMRANK_HISTORY_TOKEN`（与 `INGEST_TOKEN` 相同）
- `TTMRANK_MAINTENANCE_TOKEN`（与 `MAINTENANCE_TOKEN` 相同）

未配置 D1 时，静态发布仍可完成，Actions 缓存会按 20 分钟桶保留 8 天热度点。
近 1 小时、24 小时和 7 天指标会在真实基线形成后逐项启用，等待期间显示
“历史积累中”；本地运行仍可从已有 Git 快照读取兼容基线。网站图标代理只接受
TapTap 图片域名。

## 3. 历史归档与滚动清理

D1 默认保留 90 天小时明细和 730 天日聚合。每个维护请求只处理最老的一个
UTC 日，聚合、`archived_through` 水位、完成审计、精确日删除和 `has_more`
查询位于同一事务；数据库触发器拒绝重新写入已经归档的小时。Action 单次
最多追赶 100 天，job 时间预算为 90 分钟，积压更长时可重复手动运行。即使
当前没有待归档日期，维护也会删除超过日留存期限的旧审计行。

首次启用：

1. 对现有 D1 应用最新 `cloudflare/schema.sql`。
2. 部署最新 `cloudflare/analytics-worker.js`。
3. 配置上述维护密钥。
4. 手动运行 `Maintain History` 并检查 Action 摘要。

完整指标口径、重试和失败安全机制见 `docs/history-retention.md`；变化情报状态、
缓存恢复和事件抑制见 `docs/change-intelligence.md`。

## 4. 本地服务

```bash
python app/server.py
```

默认只监听 `127.0.0.1`。排行榜页仅在本地 8080–8089 端口显示刷新按钮。
`/refresh` 只接受带站内标记的同源 `POST`，且同一时间只运行一个采集任务；
`GET /refresh`、跨站请求和并发刷新都会被拒绝。若设置 `TTMRANK_PUBLIC=1`，
服务会监听 `0.0.0.0` 并强制关闭刷新端点。

可配置项：

- `TTMRANK_ALLOWED_ORIGINS`
- `TTMRANK_MAX_REQUEST_BYTES`

不要把本地服务直接暴露到公网，也不要提交 D1 token 或 `wrangler.toml`。
项目不包含 LLM 配置、用户 API Key 存储或模型代理端点。

## 5. 数据与 Git 历史边界

仓库不保存 `app/data/history/` 全量快照。D1 按 `(game_id, captured_hour)`
幂等存储小时历史，Pages artifact 保存当前可访问站点。定时任务不再写数据
提交，因此仓库不会继续按 20 分钟累积新快照 commit。

这个改动不会自动缩小已有 Git 历史。历史重写会改变 commit hash 并需要
force-push，本轮没有执行；如确有需要，必须作为单独、明确授权的仓库维护。
