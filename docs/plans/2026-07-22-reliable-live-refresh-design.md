# 可靠实时刷新设计

## 目标

让 TTMRank 的数据采集拥有独立于 GitHub 延迟调度的 20 分钟入口，并让已打开的
情报页面低成本发现新制品；任何一端停滞时，页面都要直接显示数据延迟，不能继续
用“每20分钟采集”暗示数据仍然新鲜。

## 调度架构

独立的轻量 Worker 增加 Cloudflare Cron `*/20 * * * *`。Cron 只调用 GitHub
Actions `workflow_dispatch`，不在 Worker 内抓取 TapTap，也不等待采集完成。请求使用
仓库、工作流与分支三个公开配置，以及单独保存的 `GITHUB_ACTIONS_TOKEN` secret。
GitHub `Refresh Data` 继续作为唯一采集、校验、缓存推进和 Pages 发布入口；其并发组
保证重复触发时按顺序执行。Cloudflare 尚未部署并验证时，原有三个 GitHub schedule
入口维持原频率，避免合并代码后停更；仓库变量
`TTMRANK_CLOUDFLARE_SCHEDULER_ACTIVE=true` 后才转为看门狗，仅在最近刷新超过
45 分钟时补发，避免外部故障造成完全停更。

调度 Worker 不绑定 D1，因此可以在长期历史服务尚未配置时独立上线。Cron 结果只
记录非敏感状态。GitHub 返回 204 视为成功；配置缺失、超时或非 2xx
均抛出错误，让 Cloudflare Cron 日志直接暴露失败。Token 只需要目标仓库 Actions
写权限，不用于代码写入。

## 页面更新与性能

首页和完整变化页初次加载正常获取 manifest 与变化流。页面可见时每 5 分钟仅请求
一次带时间戳查询参数的 manifest，以绕开 GitHub Pages 最长 10 分钟 CDN 缓存。
只有 `observed_at`、`changes_sha256` 或变化文件名发生改变时，才继续下载变化流并
重绘。页面隐藏时取消计时；重新可见时立即检查；进行中的请求会合并，避免重复。

manifest 直接增加 `taptap_made_game_count`。首页当前为了显示这一项而额外下载约
886 KB 的完整分析 JSON，改造后首屏只需要 manifest 与小型变化流，因此增加后台
版本探测后总体流量仍显著下降。

页面根据 `observed_at` 计算新鲜度：60 分钟以内显示最近采集时间；超过 60 分钟显示
“数据更新延迟 · 最后采集 …”。不做秒级倒计时，不触发布局抖动。

## 验证

- Worker 单元测试覆盖成功派发、缺少配置、GitHub 拒绝和网络异常。
- 工作流测试确认 Cloudflare 启用后作为 20 分钟外部时钟；启用前 GitHub 原调度保持工作，启用后转为 45 分钟看门狗。
- 前端单元测试覆盖版本比较、缓存绕过、未变化时不下载 feed、可见性轮询和延迟文案。
- Playwright 保留全部现有交互并新增页面保持打开后读取新版本的测试。
- 完整 Python、JavaScript、Worker 与 Playwright 套件通过后再推送。
