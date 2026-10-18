# 新闻采集插件平台实施进度

日期：2026-10-18。主计划：[性能、新闻源扩展与插件化计划](02-performance-sources-platform-plan.md)。详细设计：[新闻采集插件平台调研](03-crawler-plugin-platform-research.md)。

## 当前状态

P0 同包跨宿主原型通过。P1 SDK、CLI 和离线测试工具已有首轮实现。P2/P3 动态来源目录已完成首轮代码实现，并通过固定 JSON/RSS host 测试、Node Docker API smoke 和 Electron utility process smoke；真实 renderer 窗口验收、完整数据兼容和 Pages Web→Node API 浏览器验收仍未完成。P4 安装、更新和版本回退尚未实现。P5 陌生插件隔离尚未评估。代码未部署到生产环境。

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

- Node 宿主只加载操作者通过 `LATESTNEWS_CRAWLER_PLUGIN_IDS` 明确启用的包。默认包目录是 `.data/crawler-plugins`，可用 `LATESTNEWS_CRAWLER_PLUGIN_DIR` 覆盖。
- 清单中的静态 ID 可替换对应旧 getter；未启用插件时保留旧 getter。其他频道使用 `ext.<plugin-id>.<channel-id>`。共享目录校验 ID 和元数据，并接入来源发现、详情、单源、批量、Feed、旧 ID 列表和健康摘要 API。
- 首个兼容源为 Pcbeta `pcbeta-windows11`。离线 fixture 验证插件输出继续使用旧 URL 哈希，且 Node 适配器将 `publishedAt` 映射为现有 `NewsItem.pubDate`。
- Node 宿主一次运行最多四个插件任务，最多等待 64 个任务；排队超过 30 秒返回 `TIMEOUT`，超出队列容量返回 `QUEUE_FULL`。
- Docker 镜像会把 `worker-entry.mjs` 放在服务工作目录下。Compose 提供可选环境变量；不设置时不会启用插件。已加入 `pnpm test:crawler:docker`，用于验证容器中的现有 API 能返回 fixture 插件数据。
- Pages 构建选择无 Node 能力的适配器。Pages 页面默认使用同源 API；需要读取服务端插件时，用 `VITE_NEWS_API_URL` 指向 Node API，并在 Node 配置精确的 `LATESTNEWS_WEB_ORIGINS`。`VITE_API_URL` 继续用于认证与用户同步。Node 插件不在 Pages Functions 中运行。Pages 输出包含 `_worker.js` Pages Functions 入口；这不是单独的 Workers 部署。
- Docker smoke 使用 `node:22-alpine` 本地镜像验证来源发现、详情、单源、批量和 JSON Feed。RSS 动态频道由固定响应 Node host 测试验证。真实收藏、阅读历史、离线恢复和同步往返仍未完成。

## P3：Electron 桌面本地插件接入

- Electron 主进程从 `<userData>/crawler-plugins/enabled.json` 读取启用列表，从 `packages/<plugin-id>/` 加载插件包；也支持用 `LATESTNEWS_CRAWLER_PLUGIN_DIR` 指定插件根目录。受信任 IPC 返回已验证动态来源元数据。
- 插件代码由 `utilityProcess` 子进程运行。渲染器只能通过受信任 IPC 查询已启用源 ID 和请求某个源，不能传入路径或命令。
- 共用 service 只对桌面已启用的源使用本地插件。其他来源继续调用远程 API；本地执行失败时回退到远程 API。Web 页面没有桌面 IPC，因此保持原有 API 路径。
- `electron-builder.yml` 把 `worker-entry.mjs` 安装到 `resources/crawler-platform/runtime/`。Windows 临时打包检查确认该文件和 `app.asar` 均存在。
- `pnpm test:crawler:electron` 使用 Pcbeta 静态源和 JSON 动态源验证 Node 与 Electron 宿主；同一插件包输出一致，并检查本地动态元数据。这是进程级 smoke，不是 UI 窗口验收。
- 应用目前在启动时读取本地配置和插件包。安装、启用、停用、升级、版本锁定、失败回退，以及休眠/恢复/退出时的任务清理界面和验收仍未实现。

## 验证结果

| 检查 | 结果 | 证据范围 |
| --- | --- | --- |
| `pnpm lint:check` | 通过 | 当前工作区全部 ESLint 文件 |
| `pnpm typecheck` | 通过 | Node 与 Web TypeScript 配置 |
| `pnpm typecheck:electron` | 通过 | Electron TypeScript 配置 |
| `pnpm test --run` | 通过 | 62 个测试文件、286 个测试 |
| 定向动态目录测试 | 通过 | 24 个测试；覆盖 JSON/RSS 动态 ID、来源目录、Feed 解析、命名空间拒绝和 API URL 校验 |
| `pnpm crawler validate/test` | 通过 | JSON 示例；HTML/RSS 由测试套件执行相同 CLI API |
| `pnpm electron:build` | 通过 | Electron 主进程、预加载和渲染器构建；构建过程仍报告 4 个图标下载超时和 Zod 注释警告 |
| Electron utility process smoke | 通过 | Windows、本地 Electron 44.8.0；同一个 Pcbeta 插件产物在 Node 与 Electron 返回相同条目 |
| Windows 桌面打包 | 通过 | 使用本机 Electron 44.8.0 目录打包；确认 worker 入口、`app.asar`、主进程和预加载文件存在。未运行窗口交互 |
| Pages 构建与边界 | 通过 | Cloudflare Pages preset 构建成功；产物不含 Node 插件宿主、`node:child_process`、插件环境变量或 worker 入口 |
| Node/Docker 动态 API smoke | 通过 | 本地 Docker 镜像基于 `node:22-alpine`；最终映射 `127.0.0.1:10997` 到容器 `4444`。动态来源目录、详情、单源、未知 ID 拒绝、批量、JSON Feed 和 CORS allow/deny 检查通过；脚本清理容器、临时镜像与插件目录 |
| Electron 动态插件 smoke | 通过 | Electron 44.8.0 本机二进制；Pcbeta 静态源和 JSON 动态源都运行，同一个 JSON 插件包在 Node 和 Electron utility process 返回相同条目，并读取到来源元数据 |
| 真实新闻源请求 | 未执行 | 本轮仅用固定离线响应 |
| Web/Electron 真实窗口 UI 检查 | 未完成 | Computer Use 无法确认当前浏览器 URL，按策略停止窗口输入。`pnpm dev` 另因 `vite-plugin-with-nitro` 与 `h3-nightly` 的 `__nodeHandler` 错误未能启动 |
| 代码提交与推送 | 通过 | 初始 SDK/Node/Electron 接入及动态来源目录、客户端注册批次均已分别验证并推送到 `origin/main` |

## 未完成范围和回退边界

Node 服务可以发现动态频道，客户端源码会在加载路由前注册远程或本地目录；Pages Web 可通过 `VITE_NEWS_API_URL` 指向 Node API，并用 `LATESTNEWS_WEB_ORIGINS` 限制 CORS 来源。当前实现还未通过真实窗口、线上 Pages 配置和收藏/历史/离线/同步端到端验收。F5 的质量报告和首批真实新闻源仍未实现。

Electron 桌面包已包含 utility process 入口，但仍需在真实应用窗口中检查启动和本地源读取。当前没有插件安装界面、安装/更新/回退状态机或任务生命周期 UI。Docker 容器 API smoke 已通过；首次依赖安装中的 npm 超时通过重试恢复。

`trusted-js` 只适用于操作者信任的插件。独立进程和网络 broker 可限制平台调用、阻止任务卡住主进程并隔离环境变量；它们不能阻止任意插件代码直接访问 Node.js API。公开插件安装、更新器和陌生代码沙箱尚未实现。

可信 `trusted-js` 宿主不是陌生代码沙箱。独立进程和网络 broker 可限制宿主提供的调用、处理卡住任务并隔离进程故障；它们不能阻止任意插件代码直接使用 Node.js API。公开插件目录、包签名、更新器、凭据管理、外网/私网策略和资源限额未实现。

本轮代码已推送，但未进入生产路径。未启用插件时，Node 服务端和桌面端继续使用原有远程 API 或 getter。每个来源仍可切回内置 getter。
