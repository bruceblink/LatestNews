# N3-E 新闻条目 URL 边界验收（2026-11-25）

## 实现

基于 a9aeb96（审查 A06）。shared/news-url-policy.ts 作为新闻导航 URL 的共享策略。只接受显式绝对 HTTP/HTTPS、非空主机、不含 userinfo、反斜线、控制字符或内部空白；原始及解析后长度不超过 4096 UTF-16 code unit。允许首尾普通空白，保留合法原 URL 表示、查询和片段；不修改现有去重算法、articleKey、eventId、源条目 ID。配置型来源保留按受信基址解析相对文章链接的能力及原有更严格的 2048 长度上限。该策略不替代服务端 SSRF、防重定向和 DNS 安全边界。

- 传统来源统一 normalization 拒绝非法主 URL，并计入 invalidItemCount；合法主 URL 的非法可选 mobileUrl 字符串丢弃。插件主 URL 仍在严格宿主校验中失败，非法可选移动链接可丢弃。图片 HTTPS 策略不变。
- Node/Pages cache 写入过滤非法条目，非空输入若全部被过滤则拒绝替换旧缓存。缓存读取进行安全投影，不重写旧数据。文章索引直接写入及事件协调过滤非法 URL；历史检索、事件成员返回过滤不安全主 URL 和 canonical URL，不删除旧索引行。
- Electron JSON 缓存读取及新写入复用 URL 策略；只读加载不会重写旧文件。主进程 HTTP(S) 外部链接打开器复用校验；其既有独立 mailto 支持保留，不允许 mailto 作为新闻链接。
- Feed、洞察及 RSS/JSON 导出过滤非法文章 URL。共享 NewsLink 用于新闻卡片、来源详情、Feed、洞察与历史；旧历史/收藏可读、可移除，无有效 href、禁止触发阅读或外部跳转；移动端不合法链接回退主 URL。历史文本导出保留标题/时间并标记无效链接。

## 验收

Linux / Node 22.23.4 / pnpm 12.21.0，Electron 44.9.0。98 个 Vitest 文件、529 项通过（新增 10 项），ESLint、Node/Web/Electron 类型检查、Node、Pages、Electron 构建通过（跳过在线图标抓取）。Web Chromium 阅读流程 2/2、图片失败专项 1/1，Electron/Xvfb 阅读流程 2/2 通过（其中新增 Web 与 Electron E2E 各 1 项）。Chromium/Electron 最初缺系统动态库，在隔离环境安装系统依赖后实际运行成功；不改变仓库依赖与生产配置。

现有 event-registry-d1-smoke.mjs 增加 URL 用例，实际 Pages 构建产物运行在独立 Miniflare/workerd D1：非法新写入、旧来源缓存过滤、FTS/事件详情、可选移动链接与旧数据原样保留均通过。复用 N4-G 测试参数和临时 D1，兼容日期 2026-08-06，不代表目标 D1 生产验收。

```bash
pnpm exec vitest -c vitest.config.ts run test/news-url-policy.test.ts server/database/cache.test.ts server/database/article-index.test.ts test/electron-crawler-cache.test.ts test/feed-export.test.ts test/history-export.test.ts
pnpm exec playwright test --config=playwright.config.ts e2e/reading-flow.e2e.spec.ts --workers=1
pnpm exec playwright test --config=playwright.config.ts e2e/app.smoke.e2e.spec.ts --grep 'loads article icons directly' --workers=1
xvfb-run --auto-servernum pnpm exec playwright test --config=playwright.electron.config.ts electron-e2e/reading-flow.e2e.spec.ts
```

D1 复现按 [N4-G](news-event-registry.md) 的隔离安装和运行方法。

## 限制与回退

本次没有生产数据清理、数据库迁移或新依赖。对旧索引数据的过滤发生在 SQL 有界返回后，含不安全旧行的页可能少于 limit（事件页仍按原始游标前进）；后续 N4-L2 设计显式对账与恢复，不静默删除。未验证真实生产数据规模及全部源站兼容性。安全校验不代表已发现实际浏览器利用，也不保证合法 HTTP(S) 目的地可信、公开或无恶意内容。回退仅撤销代码与文档；不得为了回退删除用户记录或恢复已拒绝的不安全导航策略。
