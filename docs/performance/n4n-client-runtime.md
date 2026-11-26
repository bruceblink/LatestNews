# N4-N：客户端冷暖启动与持续运行验收

基准主线 `07b314b7972f980bcdf8152eb1605c859ff83966`。Linux x64，AMD EPYC 8 逻辑核，约 16 GiB RAM，Node 22.23.4 / pnpm 12.21.0，Chromium 156.0.8078.4 / Electron 44.9.0。使用同一提交的 Web 静态构建和未打包 Electron 构建；Web 服务仅监听回环，新闻 API 为一来源 30 篇固定文章夹具。每次测试使用独立临时 profile，外部目的地经 Chromium proxy 和 DNS 规则限制；Web service worker 禁用，GPU 加速禁用。Electron 通过正常 API 配置使用未打包应用允许的回环 HTTP，不改变正式包 HTTPS 安全规则。

## 复现

```sh
# Node 22 + pnpm，确保已安装 Chromium、Electron 和相应系统依赖。
LATESTNEWS_SKIP_FAVICON_FETCH=true VITE_API_URL=/ VITE_NEWS_API_URL='' pnpm build:web:test
LATESTNEWS_SKIP_FAVICON_FETCH=true pnpm electron:build
pnpm performance:client-runtime web startup
xvfb-run --auto-servernum pnpm performance:client-runtime electron startup
pnpm performance:client-runtime web endurance 1800
xvfb-run --auto-servernum pnpm performance:client-runtime electron endurance 1800
```

本轮长测两客户端同机并行、不同临时 profile 与回环端口；复现可并行启动上面两条 endurance 命令，单独启动的结果需标注负载差异。启动实验不并行。记录写至 .data/performance；不接触生产数据。不将开发预检、短时 pilot、失败配置尝试计入正式结果。

## 测量定义

- 冷启动：新 profile，启动独立 Chromium/Electron 进程。Electron 仅预置合法回环远端模式配置，避免第一次初始化连接真实服务。暖启动：关闭进程后复用同一 profile 再启动。不是 OS 页缓存冷启动；不重启机器、不清空操作系统缓存。
- 记录从进程启动调用至默认阅读洞察标题可见、第一条固定报道可见的墙钟时间。包含进程创建、Playwright 控制连接、导航、应用初始化及必要请求。Web 同源静态文件采用可缓存响应，HTML/API 不缓存；Electron 本地资源采用 app 协议。不同客户端协议和控制机制不同，不能视为严格同构比较。
- CDP Performance.getMetrics 与 Memory.getDOMCounters 记录 JS heap、DOM 节点、文档、事件监听器及 TaskDuration；采样不强制 GC。Linux /proc 按临时 profile 参数查找进程及其子树并累加 VmRSS（包含共享页重复计数，不是 PSS 或系统实际总占用）。Electron 另采 app.getAppMetrics 的进程级 workingSetKiB/CPU 和窗口数量。
- 长测先预热一轮，再以单调时钟执行 1,800 秒；每 15 秒循环操作 Feed、点击文章、档案检索、事件详情、阅读历史（校验该文章已读记录）、返回洞察。Web 文章 popup 由夹具响应并关闭，Electron shell opener 在测试进程内替换，不执行真实外部打开。30 篇文章循环复用。
- 每约 60 秒从相同路由阶段采样；每轮等待 fixture 的在途 HTTP 请求清空。检查必要标题/文章、阅读历史、无观察到的 pageerror、无未识别 API/静态请求错误、完成持续时长、结束后无关联 profile 的残留进程。注意 fixture HTTP 积压不是生产数据库 journal 或插件队列；内存变化不是自动的泄漏证明，也不设置未经批准的 SLO。

## 冷暖启动结果（5 对 / 客户端）

| 指标 | Web 冷 | Web 暖 | Electron 冷 | Electron 暖 |
| --- | ---: | ---: | ---: | ---: |
| 标题可见中位数 ms | 374.647 | 338.844 | 771.203 | 684.841 |
| 首条报道可见中位数 ms | 381.966 | 352.853 | 779.677 | 767.438 |
| 首条报道最小–最大 ms | 354.609–429.647 | 343.003–371.470 | 692.122–1330.682 | 691.397–799.981 |
| JS heap 中位数 bytes | 6726708 | 6553408 | 7880384 | 7943024 |
| 进程 RSS 和中位数 KiB | 501740 | 501292 | 619236 | 618944 |
| 每次 fixture API 请求数 | 5 | 5 | 4 | 4 |

20 次启动都到达真实的可见内容检查点，fixture 请求无未识别/静态错误，最后无在途 fixture 请求。Electron 首次冷启动为 1,330.682 ms；未删掉这一较慢样本。Web 初次构建误把 VITE_NEWS_API_URL 设为 /，被已有合法 URL 规则拒绝；改为留空的同源配置后完成全部正式测量，不放宽应用规则。Electron auth 固定域名不可达由隔离 proxy 拒绝，故不把未走真实认证服务的启动样本外推到生产。启动记录：[Web](n4n-client-web-startup-2026-11-25.json)、[Electron](n4n-client-electron-startup-2026-11-25.json)。

## 持续运行

20 秒 Web/Electron 阅读及路由预检通过（包括阅读历史校验与退出后无 profile 关联进程）。正式 1,800 秒测试尚未取得完成报告；本 PR 仅关闭冷暖启动门槛并交付长测工具，不宣称长测通过。启动样本的执行代码与本 PR 启动分支相同；后续仅增加 endurance 文章点击、退出检查和 common unexpectedRequests 断言，原启动报告的该计数已核实为 0。

## 仍需独立验收

真实源站、生产 D1、独立人工标注、PWA service worker 长测、正式包受信 HTTPS、原生托盘和 Windows/macOS 实机。此处无生产运行时变更或发布。

后续正式双端 1800 秒验收与生命周期修复：[N4-N 客户端持续运行](n4n-client-endurance.md)。使用新版实际内容可见时延定义，旧启动与短时预检数据不直接混比。
