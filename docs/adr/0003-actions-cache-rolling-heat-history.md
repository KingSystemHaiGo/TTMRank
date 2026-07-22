# ADR-0003: Actions 缓存承载短期热度历史后备

## Status

Accepted

## Context

TTMRank 的近 1 小时、24 小时和 7 天增长需要跨轮热度快照。Cloudflare D1 是长期
历史存储，但生产仓库尚未配置其 URL 与令牌；定时采集制品只通过 GitHub Pages
artifact 发布，不进入 Git 历史，因此 Git fallback 无法取得新基线。页面由此把全部
近期指标显示为“历史暂不可用”。

历史恢复不能增加网页下载量，不能恢复每 20 分钟提交大 JSON，也不能让外部历史
服务失败阻断静态站发布。

## Decision

在 `.ttmrank/heat-history.json` 保存紧凑的 20 分钟热度桶，保留最近 8 天，并使用
独立的 GitHub Actions 缓存命名空间。每轮生成分析前读取已有点，生成制品后原子
写入当前点。D1 已配置时仍为优先数据源；滚动状态作为缺省后备与短期恢复路径。

热度缓存与变化状态缓存分离，避免缓存路径版本变化使已经建立的七日变化状态失效。

状态只包含 `game_id`、桶时间、热度和可选评分，不进入 Pages artifact。损坏、缺失
或 schema 不兼容时安全重建。每个游戏每个桶只保留最新值，旧于 8 天的数据删除。

## Consequences

### Positive

- 无需外部服务即可逐步恢复 1h、24h、7d 增量。
- 不增加客户端请求或页面内存。
- 不产生高频 Git 提交，缓存体积有界。

### Negative

- 缓存被 GitHub 回收时需要重新积累窗口。
- 7 天指标首次启用后必须等待真实 7 天，不能伪造历史。
- D1 未配置时无法提供超过 8 天的长期查询。

### Neutral

- 页面逐字段显示“历史积累中”，而不是用一个总开关隐藏所有历史指标。

## Alternatives Considered

- 每 20 分钟提交排行榜 JSON：拒绝，会膨胀 Git 历史并增加冲突。
- 把历史嵌入前端分析 JSON：拒绝，会明显增加下载和内存。
- 只等待 D1 配置：拒绝，会让核心分析能力在未配置期间永久空缺。

## References

- `docs/change-intelligence.md`
- `docs/history-retention.md`
