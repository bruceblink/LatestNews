# Cloudflare Pages 新闻接口运行时修复

日期：2026-10-24。基线：c2032c6。

## 范围与原因

用户提供的生产日志记录了 `/api/s?id=juejin` 返回 HTTP 500，异常为 `Cannot read properties of undefined (reading 'split')`。本地 Pages 产物中，Cheerio 的 Node 入口引入了 Undici。Undici 在模块初始化时执行 `process.versions.node.split(...)`。来源注册模块会加载全部来源，因此不使用 Cheerio 的掘金接口也会触发该异常。

本地删除 `process.versions.node` 后，请求旧产物的无效来源接口，已复现相同异常和 HTTP 500。该复现只模拟日志中的缺失字段，不代表完整 Cloudflare 运行环境。此前的 Worker 模块布局修复没有覆盖这类依赖初始化问题。GitHub 检查中的 Preview URL 也不足以证明生产分支配置错误。

## 实施计划

1. 仅在 Pages 构建中将 Cheerio 指向它自带的浏览器入口。保留 HTML 字符串解析功能，去除 Undici 和 Node 流式加载依赖。
2. 扩展 Pages 产物校验，拒绝 Undici 和 Node 版本拆分代码。删除 Node 版本字段后，请求无效来源，确认来源模块能加载并返回 HTTP 400。校验不请求外部新闻源。
3. 执行静态检查、单元测试、Pages 构建和本地 Pages 请求验证。提交并推送修复后，单独验证生产域名和部署预览地址。

## 验收条件

- `pnpm lint:check`、`pnpm typecheck`、`pnpm test --run` 通过。
- `pnpm build:pages` 通过。Worker 不包含 Undici 的 Node 版本检查，缺少 Node 版本字段时，无效来源返回 HTTP 400。
- 本地 Pages 的掘金接口能返回新闻数据。
- 部署后，`https://news.likanug.top/api/s?id=juejin` 返回 HTTP 200 和新闻数据，无效来源返回 HTTP 400。生产域名结果单独记录，不能用本地结果代替。
- 本次没有 UI 变更，真实窗口 UI 验收不适用。数据库绑定配置不属于本次修复范围。

## 回退边界

移除 Pages 的 Cheerio 别名和新增产物校验即可回退本切片。来源 ID、响应结构、Node/Docker 构建和桌面采集逻辑不变。保留此前 Worker 模块布局和数据库显式导入修复。

## 本地验证结果

- `pnpm typecheck` 通过；`pnpm test --run` 的 74 个文件、360 个测试通过。
- `pnpm build:pages` 通过。Worker 从约 2.9 MB 缩小到 1.62 MB，缺少 `process.versions.node` 时，无效来源返回 HTTP 400。
- Wrangler 4.152.0 编译和本地运行通过。掘金旧接口、掘金 v1 接口、IT之家均返回 HTTP 200，各返回 30 条新闻；无效来源返回 HTTP 400。
- 本地 Wrangler 没有绑定 D1，数据库初始化记录 `LATESTNEWS_DB not found`。上述新闻请求仍成功；本次没有验证数据库集成。
- 全量 `pnpm lint:check` 被既有未跟踪文件 `electron/crawler-plugin-seeder.ts` 的导入排序错误阻断。保留该文件后，临时排除它执行 `pnpm exec eslint . --ignore-pattern electron/crawler-plugin-seeder.ts` 通过。本次修改文件的 lint 通过，没有修改仓库 lint 配置。
- `git diff --check` 通过；本次修改文件均使用 LF。部署验证结果待单独记录。
