# TTMRank 部署指南

TTMRank 的主站仍是 GitHub Pages 静态站点。当前排行榜与 v2 分析文件提交到仓库；刷新任务默认直接读取已有 Git 提交中的 `rankings.json` 计算 1 小时、24 小时和 7 天基线，不再要求额外保存全量历史文件。Cloudflare D1 仅是可选替代数据源。

## 1. GitHub Pages

1. 在仓库 `Settings → Pages` 中选择 `GitHub Actions`。
2. 在 `Settings → Actions → General` 中给工作流 `Read and write permissions`。
3. 推送到 `main` 或 `master` 后，`Deploy to GitHub Pages` 会先运行 Python 和 JS 单元测试，再上传 `app/`。
4. 分支和 Pull Request 会运行完整测试工作流，包括 Chromium 端到端测试。

`Refresh Data` 从每轮开始时间起每 20 分钟自行发起下一轮，不再依赖 GitHub cron 维持正常频率。三个独立计划工作流保留为断链看门狗：只有中央刷新既未运行也未排队时才会重启链路。GitHub 的计划任务是尽力调度，因此看门狗可能延迟，但不会影响正常自续跑周期。该方案会持续占用一个公共仓库 Actions Runner 等待下一轮；若仓库改为私有或需要控制 Runner 用量，应改用外部 Cloudflare/Vercel Cron。采集失败不会用空榜覆盖正式数据；业务数据没有变化时不会生成提交。工作流摘要会显示游戏数、榜单记录数、质量告警、文件体积和小时历史状态。

## 2. 小时历史与图标代理（可选）

安装 Wrangler 后，在 `cloudflare/` 目录创建 D1 数据库并应用 schema：

```bash
npx wrangler d1 create ttmrank-history
npx wrangler d1 execute ttmrank-history --file schema.sql --remote
```

复制 `cloudflare/wrangler.toml.example` 为本地 `wrangler.toml`，填写 D1 `database_id`。不要提交真实 token。为分析 Worker 配置：

- `ALLOWED_ORIGINS`：例如 `https://kingsystemhaigo.github.io`。
- `INGEST_TOKEN`：高强度随机密钥。

将 Worker URL 和同一写入密钥分别保存为 GitHub Actions secrets：

- `TTMRANK_HISTORY_URL`
- `TTMRANK_HISTORY_TOKEN`

两项均未设置时，采集自动使用 Git 提交历史，不影响 Pages 发布。Action checkout 必须保留完整 Git 历史。网站若要使用图标代理，可把同一 Worker URL 配置给前端的可选图标代理地址。

## 3. LLM Worker（可选）

根目录 `cloudflare-worker.js` 是独立的 LLM 代理。必须配置：

- `LLM_URL`、`LLM_KEY`
- `ALLOWED_ORIGINS`
- `LLM_MODELS`

可选限制：`MAX_BODY_BYTES`、`MAX_TOKENS`。Worker 不再把前端的 `key: worker` 当成认证；访问边界由来源白名单和服务端密钥控制。用户自己填写的 API Key 仅存于当前浏览器标签页的 `sessionStorage`，关闭标签页后清除。

## 4. 本地服务

```bash
python app/server.py
```

默认只监听 `127.0.0.1`。本地 `/refresh` 和受白名单限制的 `/llm` 可用。若设置 `TTMRANK_PUBLIC=1`，服务会监听 `0.0.0.0`，并强制关闭这两个可变更/代理端点。

可配置项：

- `TTMRANK_ALLOWED_ORIGINS`
- `TTMRANK_LLM_URLS`
- `TTMRANK_LLM_MODELS`
- `TTMRANK_MAX_REQUEST_BYTES`

不要把本地服务直接暴露到公网，也不要把 API Key、D1 token 或 `wrangler.toml` 提交到仓库。

## 5. 数据保留

仓库不再保存 `app/data/history/` 的全量快照。当前数据保存在 `app/data/rankings*.json` 与 `app/data/v2/`；小时历史由 D1 按 `(game_id, captured_hour)` 幂等存储。若仅为本地调试需要旧格式快照，可临时设置 `TTMRANK_LEGACY_HISTORY=1`，生成目录仍会被 Git 忽略。
