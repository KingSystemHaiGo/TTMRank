# 变化情报运行说明

TTMRank 每轮采集都会发布结构化变化制品 `app/data/v2/changes-current.json`。
首页默认显示最近 24 小时的 TapTap制造游戏变化，最多五条；完整变化页可切换
1 小时、24 小时、7 天、全站参考、事件类型、平台与游戏名称。全站范围只用于
对照，不改变 TapTap制造作为默认关注范围的产品约定。

## 状态与制品

`manifest.json` 通过 `changes_file` 指向当前变化制品。制品状态含义如下：

| 状态 | 含义 | 页面行为 |
| --- | --- | --- |
| `baseline` | 没有可用的上一轮比较状态 | 发布当前快照，不生成变化；下一轮恢复比较 |
| `ready` | 当前与上一轮数据均可比较 | 正常发布变化列表 |
| `partial` | 本轮存在不完整榜单或负面事件被抑制 | 发布可信的正向/中性变化，并明确提示采集不完整 |
| `error` | 变化制品无法读取或校验 | 页面保留筛选状态并提供重新读取动作 |

变化事件只保存结构化字段。排名、评分、进出榜、覆盖变化的中文句子由前端根据
`kind`、`before` 和 `after` 生成，例如“从第18名升至第9名”，避免后端固化模糊
或不可验证的解释。

## 滚动比较状态

比较状态位于 `.ttmrank/change-state.json`，不进入 Pages artifact，也不按
20 分钟提交到 Git：

1. `deploy.yml` 或 `refresh.yml` 通过 `actions/cache/restore@v4` 使用共享前缀
   `ttmrank-change-state-` 恢复最近一份状态。
2. 采集器规范化当前游戏与榜单观察值，并与上一轮状态比较。
3. 静态 JSON 全部原子发布且目标测试、JSON 校验通过后，工作流才用唯一 key
   保存下一轮状态。
4. 发布或校验失败时不保存候选状态，下一轮仍从最后一份已验证状态继续。

缓存丢失、过期、损坏或 schema 不兼容时不会猜测变化。该轮发布 `baseline`，
并建立新状态；下一次成功采集后自动恢复 `ready`。

## 负面事件质量门禁

跌出榜单和榜单覆盖减少只有在前后两轮对应榜单都完整时才会生成。以下情况会把
榜单标记为不完整，并抑制相关负面事件：

- 榜单来自缓存而不是本轮实时采集；
- 榜单为空、数量异常回退或出现错误级质量问题；
- 原始榜单 payload 结构畸形；
- 任一被移除榜单在前一轮或当前轮不完整。

被抑制数量写入 `suppressed_negative_event_count`。评分先转换为一位小数的十进制
值；`NaN`、Infinity 和其他非有限值直接忽略，不能中断整轮变化生成。

## D1 事件归档与清理

静态七日制品始终是 Pages 的主要数据源。配置 `TTMRANK_HISTORY_URL` 和
`TTMRANK_HISTORY_TOKEN` 后，流水线会把同一批结构化事件额外写入
`POST /v1/events`：

- 单批最多 500 条；`event_id` 唯一，重试不会重复写入；
- 归档失败只把 `manifest.changes_archive.status` 标为 `failed`，不阻断 Pages；
- 默认保留 180 天，可用 Worker 变量 `EVENT_RETENTION_DAYS` 调整；
- 每次维护最多删除 5,000 条过期事件，并通过 `has_more` 让 Action 有界追赶。

应用最新 `cloudflare/schema.sql` 并部署 Worker 后，再手动运行一次
`Maintain History`。事件表不存在时，静态变化流仍可独立运行。

## 自动调度与页面更新

Cloudflare Cron 每 20 分钟派发中央 `Refresh Data` 工作流；调度器不抓取数据，
也不等待发布完成。`refresh.yml` 不等待、不睡眠、不自我续跑。刷新与代码部署共享
`data-publish` 并发组，避免两轮采集同时推进状态。

仓库变量 `TTMRANK_CLOUDFLARE_SCHEDULER_ACTIVE` 未设置时，三个 GitHub 计划入口
保持原有派发，确保仅合并代码不会造成停更。部署并验证 Cloudflare 至少成功触发
一次刷新后，再把变量设为 `true`；此时三个入口切换为迁移看门狗，只在最近一次
中央刷新已超过 45 分钟时补发。Cloudflare、D1 与滚动历史均不进入网页加载链路。

情报首页和完整变化页仅在可见时每 5 分钟检查一次 manifest。检查请求带时间桶以
绕过 Pages 的 10 分钟 CDN 缓存；manifest 版本不变时不会下载变化流。标签页隐藏时
停止计时，重新可见时补查。超过 60 分钟没有新快照时，页面明确显示“数据更新延迟”。
首页游戏计数直接来自 manifest，不再为了一个数字下载完整分析 JSON。

数据刷新只运行变化、状态、流水线、校验器测试和 JSON 解析，不安装 Chromium。
代码推送部署和 `test.yml` 才运行完整 Python、JavaScript 与 Playwright 套件。

## 滚动热度历史

未配置 D1 时，`.ttmrank/heat-history.json` 在 Actions 缓存中保存 20 分钟桶，
只保留 8 天。它与变化状态使用独立缓存 key，不进入 Pages artifact，也不提交 Git。
损坏或被回收时会安全重建。1h、24h、7d 指标分别在真实时间窗口形成后启用，页面
对尚未形成的单项显示“历史积累中”。D1 配置完成后仍作为长期历史主后端。

## 手动恢复

缓存丢失后可手动建立基线：

```bash
gh workflow run refresh.yml
gh run watch
```

第一轮应显示 `baseline`。等待至少一个采集间隔后再次运行，状态应变为 `ready`
或在数据不完整时变为 `partial`。若 D1 有积压，再运行：

```bash
gh workflow run history-maintenance.yml
gh run watch
```

检查 Action 摘要中的 `Change archive`、`events_deleted`、`has_more` 和 Pages URL。
不要通过修改静态 JSON 或提交缓存文件来跳过基线周期。
