# 新闻采集插件平台实施进度

日期：2026-10-18。主计划：[性能、新闻源扩展与插件化计划](02-performance-sources-platform-plan.md)。详细设计：[新闻采集插件平台调研](03-crawler-plugin-platform-research.md)。

## 当前状态

P0 至 P4 已完成首轮实现。F4-B 又迁移了 Freebuf RSS、稀土掘金 JSON 和 Hacker News HTML 三个代表适配器，并保留静态来源 ID、旧 URL 哈希和 `NewsItem.extra` 展示字段。F5-A 已增加运行期来源质量计数、健康诊断报告和 10 个来源的低频采样工具。2026-10-27 启动 F6-A，先收口清单资源预算、共享网络权限检查和 Node/Electron 宿主边界；7 天公网采样窗口、真实窗口验收、完整数据兼容和 Pages Web→Node API 浏览器验收仍未完成。P5 陌生插件隔离尚未评估。代码未部署到生产环境。

## F6-A：清单预算与宿主边界收口（当前排期）

- `manifest.limits` 统一声明任务期限、单次运行请求次数、请求体、单次响应、累计响应、条数和输出字节上限；旧清单通过默认值保持兼容。
- Node 子进程宿主和 Electron utility process 共用 `ProcessCrawlerHost`，在 broker 转发前检查 HTTPS origin、凭据、方法和请求体，在响应和结果边界执行资源预算。
- SDK 本地注册表也执行请求、响应和输出预算，便于离线 fixture 与进程宿主保持相同协议行为。
- 资源越界使用 `RESOURCE_LIMIT` 错误，避免把协议拒绝和上游 HTTP 失败混为一类。`maxResponseBytes` 仍受宿主部署配置进一步收紧。
- 第一轮测试覆盖清单默认值与非法组合、请求次数、请求体和注册表预算。公网采样、公开目录、签名发布者认证、凭据管理和陌生代码沙箱不在本阶段。

## P0：同一插件产物跨宿主运行

- SDK、清单解析、标准输出校验和 JSON/HTML/RSS 样例已加入 `crawler-platform/`。
- 验收脚本只打包一次 Pcbeta 插件，并让 Node 子进程与 Electron utility process 加载同一个 `plugin.mjs`。最新 SHA-256 为 `839462b0c7f58c61ca4369f1dc929c95002a2d83af6109e5901ca20da9e5849d`。
- 两个宿主使用同一个固定 RSS 响应，返回条目完全相同。最近一次本机样本记录 Node 158 ms、Electron 200 ms。该数据包括启动和任务时间，只用于确认流程可运行，不是性能基准。
- Electron 在 Windows 进程采样中报告 Browser 工作集 84,844 KiB、网络 utility process 51,056 KiB、Node utility process 63,984 KiB。它是单次采样，不代表稳定内存占用或多平台结果。
- Electron 44.9.0 二进制下载失败。验收明确使用构建配置指定的 Electron 44.8.0 本地二进制。因此本次证明了打包目标版本的 utility process 路径；44.9.0 的独立运行时仍未验证。

## P1：SDK、清单、离线测试和打包（首轮实现）

- 插件清单验证插件 ID、版本、入口相对路径、支持的宿主、网络来源和频道定义。
- `pnpm crawler validate <plugin-directory>` 校验清单与入口文件，不执行插件代码。
- `pnpm crawler test <plugin-directory>` 将插件打包后放入 Node 子进程，只回放本地声明的 HTTP 响应。响应文件必须留在插件目录内；单个响应最多 2 MiB，全部响应最多 8 MiB。
- `pnpm crawler bundle <plugin-directory> --out <output-directory>` 生成自包含 `plugin.mjs`、规范化清单和摘要文件。命令拒绝覆盖已有输出目录。
- JSON、HTML、RSS 三个样例的离线回放、清单校验和包生成均通过。
- 宿主在加载前检查插件声明的目标。完成或取消任务时会停止未完成的 HTTP 工作；插件不响应取消时，宿主在宽限期后结束进程。
- Node 和 Electron 宿主可把非静态频道注册为 `ext.<plugin-id>.<channel-id>`。固定 JSON 与 RSS Node host 测试均验证了新增来源。插件仍需由操作者打包和启用，Web UI 安装、来源质量报告和真实客户端展示尚未验收。

## P2：Node 服务端兼容接入

- Node 宿主默认从 `.data/crawler-plugins/enabled.json` 读取启用列表。非空 `LATESTNEWS_CRAWLER_PLUGIN_IDS` 会覆盖该文件。可用 `LATESTNEWS_CRAWLER_PLUGIN_DIR` 指定其他插件存储目录。
- 清单中的静态 ID 可替换对应旧 getter；未启用插件时保留旧 getter。其他频道使用 `ext.<plugin-id>.<channel-id>`。共享目录校验 ID 和元数据，并接入来源发现、详情、单源、批量、Feed、旧 ID 列表和健康摘要 API。
- 首个兼容源为 Pcbeta `pcbeta-windows11`。离线 fixture 验证插件输出继续使用旧 URL 哈希，且 Node 适配器将 `publishedAt` 映射为现有 `NewsItem.pubDate`。
- Node 宿主一次运行最多四个插件任务，最多等待 64 个任务；排队超过 30 秒返回 `TIMEOUT`，超出队列容量返回 `QUEUE_FULL`。
- Docker 镜像会把 `worker-entry.mjs` 放在服务工作目录下。Compose 提供可选环境变量；没有启用列表或环境变量时不会加载插件。`pnpm test:crawler:docker` 会在本地镜像内从版本目录加载 fixture 插件。
- Pages 构建选择无 Node 能力的适配器。Pages 页面默认使用同源 API；需要读取服务端插件时，用 `VITE_NEWS_API_URL` 指向 Node API，并在 Node 配置精确的 `LATESTNEWS_WEB_ORIGINS`。`VITE_API_URL` 继续用于认证与用户同步。Node 插件不在 Pages Functions 中运行。Pages 输出包含 `_worker.js` Pages Functions 入口；这不是单独的 Workers 部署。
- Docker smoke 使用 `node:22-alpine` 本地镜像验证来源发现、详情、单源、批量和 JSON Feed。RSS 动态频道由固定响应 Node host 测试验证。真实收藏、阅读历史、离线恢复和同步往返仍未完成。

## P3：Electron 桌面本地插件接入

- Electron 主进程从 `<userData>/crawler-plugins/enabled.json` 读取启用列表，从 `packages/<plugin-id>/` 加载插件包；也支持用 `LATESTNEWS_CRAWLER_PLUGIN_DIR` 指定插件根目录。受信任 IPC 返回已验证动态来源元数据。
- 插件代码由 `utilityProcess` 子进程运行。渲染器只能通过受信任 IPC 查询已启用源 ID 和请求某个源，不能传入路径或命令。
- 共用 service 只对桌面已启用的源使用本地插件。其他来源继续调用远程 API；本地执行失败时回退到远程 API。Web 页面没有桌面 IPC，因此保持原有 API 路径。
- `electron-builder.yml` 把 `worker-entry.mjs` 安装到 `resources/crawler-platform/runtime/`。Windows 临时打包检查确认该文件和 `app.asar` 均存在。
- `pnpm test:crawler:electron` 使用 Pcbeta 静态源和 JSON 动态源验证 Node 与 Electron 宿主；同一插件包输出一致，并检查本地动态元数据。这是进程级 smoke，不是 UI 窗口验收。
- 桌面主进程继续从 `<userData>/crawler-plugins/enabled.json` 读取启用列表。P4 让同一 CLI 管理的版本化包可以供桌面 utility process 加载；渲染器仍只能请求已注册来源，不能传入插件路径。

## P4：静态目录与包生命周期

- `crawler-platform/catalog.json` 保存本地可信目录。目录条目只能使用相对来源路径；CLI 校验插件 ID、版本、名称和清单是否一致，并拒绝重复 ID、重复版本和路径越界。
- `pnpm crawler install|update` 将源打包到临时目录，核对包结构、大小和 SHA-256 后，再将版本安装到 `packages/<plugin-id>/versions/<version>/`。`active.json` 通过原子文件替换切换活动版本。
- CLI 支持 `catalog validate`、`list`、`enable`、`disable`、`pin`、`unpin` 和 `rollback`。固定版本会阻止更新和回退；取消固定后可以继续更新。回退只切换活动版本，不删除安装包。
- Node 与 Electron 使用相同的 `enabled.json` 和版本目录。Node 环境变量仅在非空时覆盖文件设置。Electron 无效本地配置继续使用远程 API。
- 新宿主优先读取 `packages/<plugin-id>/`。Node 旧平铺目录仍可读取；CLI 固定或更新旧包时会先复制到版本化目录。安装失败不会切换活动版本。
- 包打包关闭 Vite 默认 `public/` 拷贝，避免应用图标等无关静态文件进入爬虫包。安装只处理文件，不运行插件入口代码。SHA-256 用于发现内容损坏，不代表发布者身份已认证。
- `test/crawler-plugin-store.test.ts` 覆盖安装、更新、固定、取消固定、回退、停用、旧目录迁移、摘要损坏、活动版本路径穿越、静态目录校验和 CLI 安装。

## F4-B：代表适配器迁移

- `crawler-platform/plugins/freebuf` 迁移 `freebuf` RSS 源，使用 `https://www.freebuf.com/rss`，输出继续使用旧 URL 哈希。
- `crawler-platform/plugins/juejin` 迁移 `juejin` JSON 源，保留文章 URL 结构和旧 URL 哈希。
- `crawler-platform/plugins/hackernews` 迁移 `hackernews` HTML 源，保留条目 URL、评分 `extra.info` 和旧 URL 哈希。
- `CrawlerItem.extra` 与 Node/Electron `NewsItem` 映射已覆盖 `hover`、`date`、`info`、`diff` 和 `icon`，插件输出限制继续由宿主统一执行。
- 三个插件均提供 `manifest.json`、本地响应 fixture 和 `test-fixtures.json`，并已加入 `crawler-platform/catalog.json`。

## F5-A：运行期来源质量报告首轮实现

- 服务端标准化阶段记录原始、有效、无效、重复和可解析发布时间条目计数，并计算空结果原因和最近样本新鲜度。
- `/api/v1/health/sources` 的每个来源增加 `quality` 计数；`/api/v1/health/diagnostics` 的 JSON 与文本报告增加成功率、有效条目率、重复率、发布时间完整率、空结果次数和新鲜度。
- 统计窗口从服务进程首次采样开始。服务重启后重新开始。`source-quality:sample` 使用同一组重点来源，按显式 HTTPS 地址和低频间隔追加 JSONL 记录；`source-quality:report` 汇总成功率、非空率和新鲜度分位数；7 天公网采样窗口仍未执行。

## 验证结果

| 检查 | 结果 | 证据范围 |
| --- | --- | --- |
| `pnpm lint:check` | 通过 | 当前工作区全部 ESLint 文件 |
| `pnpm typecheck` | 通过 | Node 与 Web TypeScript 配置 |
| `pnpm typecheck:electron` | 通过 | Electron TypeScript 配置 |
| `pnpm test --run` | 通过 | 63 个测试文件、291 个测试 |
| 定向动态目录测试 | 通过 | 24 个测试；覆盖 JSON/RSS 动态 ID、来源目录、Feed 解析、命名空间拒绝和 API URL 校验 |
| `pnpm crawler validate/test` | 通过 | JSON 示例、Freebuf RSS、稀土掘金 JSON、Hacker News HTML；Pcbeta 仍保留兼容样例 |
| `pnpm crawler catalog validate` | 通过 | Pcbeta、Freebuf、稀土掘金和 Hacker News 四个目录包 |
| 定向来源质量测试 | 通过 | 标准化计数、健康聚合、诊断报告和旧来源抓取回归；4 个测试文件、19 个测试 |
| `pnpm electron:build` | 通过 | Electron 主进程、预加载和渲染器构建；构建过程仍报告 4 个图标下载超时和 Zod 注释警告 |
| Electron utility process smoke | 通过 | Windows、本地 Electron 44.8.0；版本化 Pcbeta 和 JSON 包在 Node 与 Electron 返回相同条目。Electron 44.9.0 下载失败，因此未验证该二进制 |
| Windows 桌面打包 | 通过 | 使用本机 Electron 44.8.0 目录打包；确认 worker 入口、`app.asar`、主进程和预加载文件存在。未运行窗口交互 |
| Pages 构建与边界 | 通过 | Cloudflare Pages preset 构建成功；产物不含 Node 插件宿主、`node:child_process`、插件环境变量或 worker 入口 |
| Node/Docker 动态 API smoke | 通过 | 本地 Docker `node:22-alpine` 镜像；最终映射 `127.0.0.1:3713` 到容器 `4444`。从 `enabled.json` 读取版本化包；动态来源目录、详情、单源、未知 ID 拒绝、批量、JSON Feed 和 CORS allow/deny 检查通过，临时容器、镜像与插件目录已清理 |
| Electron 动态插件 smoke | 通过 | Electron 44.8.0 本机二进制；Pcbeta 静态源和 JSON 动态源均从版本目录运行。同一 JSON 包在 Node 与 Electron utility process 返回相同条目，并返回来源元数据 |
| 真实新闻源请求 | 未执行 | 本轮仅用固定离线响应 |
| Web/Electron 真实窗口 UI 检查 | 未完成 | Computer Use 无法确认当前浏览器 URL，按策略停止窗口输入。`pnpm dev` 另因 `vite-plugin-with-nitro` 与 `h3-nightly` 的 `__nodeHandler` 错误未能启动 |
| Pages worker 边界 | 通过 | Cloudflare Pages 产物不含 Node 插件宿主、`node:child_process`、本地插件环境变量或 package store |
| 代码提交与推送 | 通过 | P4 实现提交 `11a0129` 已推送到 `origin/main`；本进度文档随后单独提交 |

## 未完成范围和回退边界

Node 服务可以发现动态频道，客户端源码会在加载路由前注册远程或本地目录；Pages Web 可通过 `VITE_NEWS_API_URL` 指向 Node API，并用 `LATESTNEWS_WEB_ORIGINS` 限制 CORS 来源。当前实现还未通过真实窗口、线上 Pages 配置和收藏/历史/离线/同步端到端验收。来源质量报告优化和更多适配器迁移仍未实施。

Electron 桌面包已包含 utility process 入口。当前没有插件安装界面；操作者通过 CLI 安装和维护本地包。休眠、恢复、退出时的任务生命周期 UI 和真实窗口验收仍未完成。

`trusted-js` 只适用于操作者信任的插件。独立进程和网络 broker 不能阻止任意插件代码直接访问 Node.js API。当前 CLI 只使用仓库内受审查的静态目录；公开目录、签名发布者认证、凭据管理、外网/私网策略和陌生代码沙箱仍未实现。P5 需先验证隔离方案，再决定是否接受第三方插件。

本轮代码已推送，但未进入生产路径。未启用插件时，Node 服务端和桌面端继续使用原有远程 API 或 getter。每个来源仍可切回内置 getter。
