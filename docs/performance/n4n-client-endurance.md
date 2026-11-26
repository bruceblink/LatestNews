# N4-N 客户端持续运行验收（2026-11-26）

基线 b5b74c455c3ecc03fbbf6f528fc0365928acf6a1（#43 已变基合并）。实际构建同一基线的 Web 静态产物和未打包 Electron。正式 v0.9.0 的发布包验收由 N1-D 另计，不能将本次结果作为正式包或生产验收。只修改性能工具、测试与证据，不改变应用运行时、生产配置、数据库、同步及发布。

## 方法和准入

- 复用 performance:client-runtime；同机并行两个独立进程、独立临时 profile 与回环 HTTP 夹具服务。30 篇固定合成报道、一个来源、真实 Web/Electron UI、实际浏览器操作。Web 禁用 service worker，Electron 使用未打包模式允许的回环 HTTP；关闭 GPU，隔离宿主使用 --no-sandbox，外部 Chromium 请求经拒绝代理和 DNS 规则限制。Electron shell.openExternal 仅在测试进程替换，Web popup 由本地 fixture 接管并关闭。没有真实源站请求、远程认证、生产 D1 或 SyncHub 服务。
- 先预热一轮，随后单调时钟固定 15 秒操作槽位，1800 秒共 120 槽位；不补发已过期槽位。每轮包括 Feed 报道可见、阅读操作、档案检索/事件详情可见、阅读历史可见、洞察报道可见。计时为真实操作及内容可见墙钟耗时，不再仅以路由标题作为完成判据。单独记录 P50/P95/P99/max（nearest rank），不与旧的仅标题时延直接比较。归档阶段包含输入、检索和详情跳转，不是单个 API 响应时延。
- 每约 60 秒在完成相同路由阶段且夹具 HTTP 请求已排空后采样 CDP JS heap、DOM nodes、documents、listeners、TaskDuration、窗口数、Linux /proc 进程树 RSS 与 API 计数；同时采 Electron app.getAppMetrics。RSS 为各进程 VmRSS 之和，含共享页重复计算；JS heap 不强制 GC。首次/最后五个采样的中位数及全窗口 min/max 用于识别趋势，不自动证明泄漏/无泄漏。采样与 IPC、磁盘写入有少量开销；同机并行不是独占主机性能。
- 启动与每分钟 checkpoint 原子写入报告文件，running 不等于 passed；最终报告需要完成时间、全部计划槽位、无页面错误/未识别请求/静态资源失败、无多余窗口和残留 profile 进程，且逐条阅读历史、API 故障降级/恢复和持久化验证通过。异常终止仅保留最近完整 checkpoint，不会误判为通过。
- 结束输入后单独模拟 Feed API HTTP 503 并刷新页面/显式刷新，确认历史内容仍可见、失败状态可见，恢复服务后重试成功；Web 再验证新鲜 Feed 和来源目录重载零重复请求。重载前后以及关闭、重新打开同一 profile 后核对阅读历史 URL 精确集合和去重；退出后确认关联进程归零。该测试是后端 API 不可用，不等于全网络断开或 service worker 长测。独立 Web PWA 离线 reload/过期快照已有 E2E，正式结果另列。
- 记录两端报告、原始采样和周期时延，保留异常；不使用未经批准的绝对生产 SLO。真实独立人工新闻质量复核仍需两名审核者，不代填标签。

## 复现

```sh
LATESTNEWS_SKIP_FAVICON_FETCH=true VITE_API_URL=/ VITE_NEWS_API_URL='' pnpm build:web:test
LATESTNEWS_SKIP_FAVICON_FETCH=true pnpm electron:build
# 两条命令同机并行；也可单独运行但必须记录不同负载条件。
pnpm performance:client-runtime web endurance 1800
xvfb-run --auto-servernum pnpm performance:client-runtime electron endurance 1800
```

报告位于 .data/performance；从 evidence 日志定位路径。运行期间不执行其他基准、构建或全量测试。不要使用真实用户 profile。先验收运行工具的短时预检，再启动正式 1800 秒。报告只使用合成夹具。
