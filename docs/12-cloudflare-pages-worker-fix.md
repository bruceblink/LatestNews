# Cloudflare Pages Worker 构建修复

日期：2026-10-24。基线：788e60b。本切片修复 Web 动态接口在 Cloudflare Pages 运行时返回 HTTP 500 的构建问题。

## 已复现的问题

- 远端首页、/feed 和 /api/v1/openapi.json 返回 200。
- /api/enable-login 返回预期的 506；/api/latest 返回 200。
- /api/v1/node、/api/v1/sources、/api/v1/health/* 和 /api/s 统一返回 500。
- 对同一份 dist 产物运行 Wrangler 时，构建报告 18 个 Could not resolve "../index.js"。多个 Worker 模块反向导入入口模块中的 logger。
- Pages 生成的 _chunks/cache.mjs 调用 useDatabase()，但缺少对应导入。该问题由本切片同时修复。

静态资源可访问、部分简单路由可执行，说明 Pages 项目和域名正常。故障位于 Nitro Worker 产物，不是新闻源网络或前端页面。

## 实现

- vite-nitro.ts 在 CF_PAGES 分支显式设置 rollupConfig.output.inlineDynamicImports。Pages 预设默认使用模块拆分，其输出配置会覆盖 Nitro 顶层开关，因此必须在输出配置中设置。
- pwa.config.ts 使用 globIgnores 排除 _worker.js/**。Worker 是服务端入口，不能进入浏览器 PWA 预缓存。
- scripts/verify-pages-output.mjs 校验 Worker 入口存在、没有拆分模块、没有入口自引用，并确认 PWA 清单不含 Worker。该检查已加入 pnpm build:pages。
- server/database/cache.ts 和 server/database/source-health-events.ts 改为显式导入 nitro/database 的 useDatabase，并增加 SQLite 内存数据库测试。

## 验证结果

- pnpm build:pages：通过。产物为单个 dist/_worker.js/index.js，没有 .mjs 拆分模块；PWA 预缓存 53 项。
- Wrangler 4.152.0 Pages 本地运行：Worker 编译成功。
- 本地 Pages 运行时接口：首页、/api/latest、/api/v1/node、/api/v1/sources、/api/v1/health/deployment、掘金单源、批量、/api/s 和 /api/s/entire 返回 200；无效来源返回 400。
- 本地 Wrangler 未绑定 D1。缓存初始化记录 binding not found，健康接口返回 degraded；新闻接口仍可返回数据。该结果不代表线上 D1 已配置。
- pnpm test --run：72 个测试文件、347 个测试通过。
- pnpm lint:check、pnpm typecheck、pnpm typecheck:electron、Node 生产构建和 Electron 构建通过。

## 验收边界

- 本轮没有 Cloudflare 凭据、部署控制或线上构建日志，不能声称 news.likanug.top 已恢复。必须部署本切片产物后重新检查真实接口。
- 7 天重点源采样尚未开始。线上接口恢复前，采样结果仍会记录失败。
- 本修复只恢复 Pages Functions 的构建和运行。Web 采用自托管边缘采集节点时，Cloudflare Pages 仍应只承载静态用户入口；API 应通过 VITE_NEWS_API_URL 指向自托管 Node/Docker 节点，或由该节点同源承载页面与 API。

## 回退边界

移除 CF_PAGES 的输出配置和 PWA 排除规则，并删除构建后校验，即可恢复原 Pages 产物。缓存导入修复应保留。不改变来源 ID、API 响应结构、缓存格式或桌面采集策略。
