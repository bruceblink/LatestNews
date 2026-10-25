# 后续开发计划

日期：2026-10-24。基线：`main` 的 `55c1f52`。

本计划承接 F2-A/F2-B。当前主线已经完成采集资源边界、Web/Electron 性能切片、Source SDK、代表适配器迁移和首轮来源质量指标。下一阶段固定重点来源的低频采样和长期记录，再根据记录补充质量阈值与维护动作。每个切片独立提交，完成验证后再开始下一项。

## 近期执行顺序

| 顺序 | 切片 | 目标 | 依赖 |
| --- | --- | --- | --- |
| 01 | F2-C 响应体边界 | 统一限制内置源、特殊请求和插件 HTTP 的解压后响应字节数 | F2-B |
| 02 | F2-D 慢源部分结果 | 采集期限结束时保留已完成结果、旧缓存和明确失败原因 | F2-C |
| 03 | F2-E 特殊请求收口 | 将 `$fetch.raw` 等绕过 `myFetch` 的来源请求纳入调度与边界 | F2-C |
| 04 | F3-A Web 查询与首屏 | 减少重复请求和非首屏资源，建立 Web 比较数据 | F2-D |
| 05 | F3-B Electron 生命周期 | 验证桌面启动、切页、最小化恢复和资源释放 | F3-A |
| 06 | F3-C 统一设置入口 | Web 与 Electron 共用独立设置按钮；桌面端可覆盖新闻数据源 API 根地址 | F3-B |
| 07 | F3-D Playwright E2E | 建立 Web Chromium 和 Electron smoke 测试及 CI 入口 | F3-C |
| 08 | F4-A Source SDK | 固定抓取上下文、解析工具、清单校验和本地样例约定 | F2-E、F3-C |
| 09 | F4-B 适配器迁移 | 迁移 RSS、JSON、HTML 三类代表源并保留兼容行为 | F4-A |
| 10 | F5-A 质量报告 | 建立来源成功率、空结果、重复率和新鲜度报告 | F4-B |
| 11 | F5-A 重点源采样 | 固定 10 个代表来源，按低频计划写入长期 JSONL 记录 | 10 |

F2-C 至 F2-E 组成 `0.7.0` 的稳定性范围。F3 需要浏览器和 Windows 实际窗口证据；没有对应设备时只记录已执行的自动化和 headless 范围。F4/F5 的公网源采样与本地 fixture 分开记录。

## F2-C：响应体大小边界

### 实现范围

- 在服务端统一定义 Node 采集响应上限，按解压后的字节数计算。
- `myFetch` 不能直接把无限响应交给 ofetch 的 JSON、文本或 ArrayBuffer 解析器；超限时尽早取消读取并返回可识别的来源失败错误。
- 迁移直接使用 `$fetch.raw` 的来源请求，保留请求头和 Cookie 获取行为，并使用相同的调度、超时和响应边界。
- 插件 HTTP broker 继续在读取阶段限制响应；进程宿主只做协议边界复核，避免重复构造大型字符串。
- 记录 Content-Length 仅作提前拒绝依据，最终判定仍以实际读取字节数为准。压缩响应按解压后的数据计量。

### 验收条件

- 小于上限的 JSON、文本和 ArrayBuffer 响应保持现有类型与解析结果。
- 超过上限的响应在读取完成前被取消，来源健康记录包含明确的响应过大原因。
- 重试、队列 slot 和取消路径在超限后正确释放，不留下活动请求。
- 插件 HTTP、内置 `myFetch` 和特殊请求使用相同的默认上限，并允许测试注入较小上限。

### 回退边界

关闭统一读取包装即可恢复现有解析路径；不改变来源 ID、缓存格式或 API 响应结构。

## F2-D：慢源部分结果

- 为批量采集增加总等待预算，返回已完成来源、可用旧缓存和每个缺失来源的失败原因。
- 保留现有 Feed 分批结构和旧客户端字段；先通过内部诊断字段表达超时，不让单个慢源清空其他来源。
- 后台刷新与调用方取消分开处理。调用方结束后，是否继续后台任务必须由明确策略决定并记录。
- 使用本地可控 HTTP 服务覆盖快源、慢源、429、5xx、畸形响应和队列饱和。

## F2-E：特殊请求收口

- 搜索所有服务端网络入口，统一使用调度器和响应读取边界。
- 对需要读取响应头的 Cookie 或重定向请求增加受控的 raw 响应辅助函数。
- 逐个核对请求的 origin、超时、重试和错误映射，避免改变站点适配器的业务结果。

## F3–F5 验收要求

- F3 记录固定提交、Node、浏览器、窗口尺寸、冷/热缓存和请求瀑布；桌面数据单独记录真实窗口证据。
- F4 每类源提供离线 fixture、清单校验和失败样例。解析失败不得转换为空列表而丢失原因。
- F5 报告至少包含成功率、有效条目数、空结果原因、重复率、发布时间完整率和最后成功时间。公网采样遵守限频。

## 验证与交付规则

代码切片完成后执行仓库要求的 lint、类型检查、定向测试和构建；影响 Electron 共用代码时追加 Electron 检查。计划阶段不把未执行的公网、浏览器、Electron 或 Docker 验收标为通过。每个切片保留变更范围、提交、环境、验证结果、未执行项和回退说明。

## F3-B：Electron 生命周期与资源释放（实现完成，真实窗口验收待执行）

### 实现范围

- `electron/lifecycle.ts` 记录应用和窗口的启动、加载、显示、隐藏、最小化、恢复、关闭及渲染进程异常事件。记录最多保留 128 条，不保存 URL 查询值、Cookie 或认证内容。
- 主进程增加受信任的 `desktop:lifecycle:diagnostics` IPC，返回窗口状态、生命周期记录和 `app.getAppMetrics()` 进程指标。预加载只暴露固定的无参数读取方法。
- Electron 采集队列、插件宿主和进程 worker 增加关闭路径。应用退出前拒绝排队任务、终止活动 worker，并释放 worker 连接，避免窗口关闭后留下采集进程。
- 新增 `pnpm performance:electron-lifecycle`。探针使用构建产物加载 `/feed`，执行最小化、恢复和关闭，再检查窗口是否清空及至少一个非零资源指标。

### 自动化验收

- `pnpm typecheck:electron`：通过。
- `pnpm lint:check`：通过。
- `pnpm electron:build`：通过。构建仍有 4 个图标下载超时和既有 Zod 注释警告，使用本地默认图标继续生成产物。
- `pnpm exec tsx scripts/performance/electron-lifecycle.ts`：通过。观察到 `app://bundle/feed`、完整的启动、最小化、恢复和关闭事件、4 个 Electron 进程，关闭后窗口数为 0；探针同时确认 React 根节点已挂载，并在临时 userData 中完成桌面新闻 API 地址的默认读取、HTTPS 地址切换、读取回写和恢复默认。
- 探针在当前工作站选择已安装的 Electron `44.8.0` 二进制运行；声明为 `44.9.0` 的 npm 包没有本地二进制，首次默认解析尝试下载时因网络不可用失败。脚本支持 `LATESTNEWS_ELECTRON_EXECUTABLE` 显式指定本地程序。

### 证据边界与回退

本轮证据覆盖构建产物和真实 Electron 进程的自动化生命周期，不替代 Computer Use 的真实可视窗口、任务栏、安装升级、macOS 或 Linux 验收。回退时删除生命周期探针、诊断 IPC 和 worker 关闭钩子即可；不改变 Web API、缓存格式、来源 ID 或远程请求目标。

## F3-C：统一设置入口与桌面数据源配置（实现完成）

### 实现范围

- Header 增加独立齿轮按钮。Web 和 Electron 打开同一个 Radix 配置面板；用户菜单不再承载设置入口。
- 新增 `/settings` 路由，复用同一个设置面板，保留直接访问和深层路由能力。
- Electron 主进程从构建默认值开始读取新闻 API origin。设置面板通过受信任 IPC 读取、保存和恢复地址，配置写入 `userData/news-api-config.json`，不保存认证凭据。
- 保存后刷新页面，使后续 `/api` 请求使用新的数据源。认证 API 和 SyncHub 地址继续使用各自的配置与凭据边界。

### 验收条件

- Web 与 Electron 构建均包含独立设置按钮和共享面板。
- Electron 生产构建只接受 HTTPS；开发构建额外接受 localhost HTTP；路径、查询、片段和凭据均被拒绝。
- 生命周期探针在临时 userData 中读取默认值、切换到测试 HTTPS origin、读取切换结果并恢复默认值，不修改用户真实配置。

### 回退边界

移除设置组件、设置路由、桌面配置 IPC 和 `news-api-config.json` 读写逻辑即可恢复构建时固定数据源；不改变 Web `/api` service、认证 API 或 SyncHub 数据格式。

## F3-D：Playwright Web 与 Electron E2E（实现完成）

### 已交付范围

- `@playwright/test`、`playwright.config.ts` 和 `playwright.electron.config.ts` 提供 Web Chromium 与 Electron 两套测试入口。
- `e2e/app.smoke.e2e.spec.ts` 使用本地 API mock 验证 Web 首页、共享设置按钮和 `/settings` 直达路由。
- `electron-e2e/settings.smoke.e2e.spec.ts` 使用临时 Electron profile 验证桌面设置路由、数据源 API URL 输入框和受信任配置 IPC。
- `pnpm test:e2e:web`、`pnpm test:e2e` 和 `pnpm test:e2e:electron` 已加入 `package.json`。Electron CI 在测试前执行 `install-electron`。
- `.github/workflows/e2e.yml` 执行 Web Chromium 和 Linux Electron E2E，并保存失败时的测试结果。

### 验证与证据边界

- `pnpm test:e2e:web`：通过，2 个 Chromium 用例。
- `pnpm electron:build`：通过。
- `LATESTNEWS_ELECTRON_EXECUTABLE=<本机缓存的 Electron 44.8.0>` 配合 `pnpm test:e2e:electron`：通过，2 个 Electron 用例，覆盖设置页读取、保存刷新和恢复默认地址。标准 Electron 44.9.0 下载因当前工作站网络不可用失败；CI 已显式安装运行时。
- `src/services/desktop-settings.service.test.ts`：通过，3 个测试覆盖 Web/Electron 桥接判断、读取、保存、恢复默认地址和不完整桥接。
- `test/electron-news-api-storage.test.ts`：通过，3 个测试覆盖桌面数据源配置的 JSON 解析、URL 校验、origin 规范化和序列化。
- `pnpm test --run`：通过，69 个测试文件、317 个测试。
- 本切片先完成 E2E 入口和 smoke 覆盖。更细的页面行为测试和持久化边界测试按后续切片补充。

### 回退边界

删除 Playwright 依赖、配置、E2E 目录和工作流即可回退；不改变生产 API、缓存、来源协议或 Electron 运行时行为。

## F4-A：Source SDK（实现完成）

### 已交付范围

- `crawler-platform/sdk` 固定插件清单、抓取上下文、取消信号、HTTP 权限边界、RSS 解析和旧 URL 哈希 ID 工具。
- `crawler-platform/core/output.ts` 在宿主边界校验条目、规范化 URL、去重并限制条目数量和响应体积。
- `crawler-platform/cli.ts` 提供清单校验、离线 fixture 回放、独立打包和本地目录校验；Node 与 Electron 共用生成的 `plugin.mjs`。
- JSON、HTML、RSS 本地样例和 Pcbeta 迁移样例固定了 `manifest.json`、`plugin.ts`、fixture 与失败边界约定。

### 证据与限制

- P0–P4 的跨宿主、动态目录和版本化包生命周期记录在 [插件平台进度记录](04-crawler-plugin-implementation-progress.md)。
- 本阶段不包含公网采样、陌生代码沙箱或插件安装界面。真实窗口和生产配置仍按单独验收记录。

## F4-B：代表适配器迁移（实现完成）

### 已迁移来源

| 类型 | 来源 ID | 插件包 | 兼容行为 |
| --- | --- | --- | --- |
| RSS | `freebuf` | `crawler-platform/plugins/freebuf` | 保留来源 ID、RSS URL 和旧 URL 哈希 ID |
| JSON | `juejin` | `crawler-platform/plugins/juejin` | 保留来源 ID、文章 URL 和旧 URL 哈希 ID |
| HTML | `hackernews` | `crawler-platform/plugins/hackernews` | 保留来源 ID、条目 URL、评分 `extra.info` 和旧 URL 哈希 ID |

插件目录已加入 `crawler-platform/catalog.json`。插件输出现在保留旧 `NewsItem.extra` 字段，Node 与 Electron 运行时会继续映射 `hover`、`date`、`info`、`diff` 和 `icon`。

### 验收条件与回退边界

- 每个代表源提供离线响应、清单校验和 fixture 回放；HTTP 失败和无条目响应会返回明确错误。
- 启用插件时只替换对应静态来源；未启用或插件失败时继续使用原有 getter 或远程 API。
- 删除三个插件目录、目录条目和 `CrawlerItem.extra` 映射即可回退；不改变缓存格式、来源 ID 或客户端 API。

## F5-A：运行期质量指标与诊断报告（首轮实现）

### 已交付范围

- 服务端标准化阶段记录原始条目数、唯一有效条目数、无效条目数、重复条目数和可解析发布时间条目数。
- 来源健康摘要增加空结果次数、空结果原因、最近发布时间、新鲜度和采样窗口开始时间。
- `/api/v1/health/sources` 继续返回原有健康字段，并附加 `quality`；`/api/v1/health/diagnostics` 的 JSON 和文本报告增加成功率、有效条目率、重复率、发布时间完整率、空结果和新鲜度。
- 未采样源显示“未采样”，不会计入成功率分母或达标判断。统计窗口从服务进程首次采样开始。

### 未完成范围与回退边界

- 运行期指标会在服务重启后重新开始，尚未替代 7 天公网采样记录；重点源名单和采样工具由下一切片冻结。
- 本切片不改变缓存、来源 ID、失败回退或客户端请求路径。删除质量统计回调、共享质量类型和诊断质量区块即可回退。

## F5-A：重点源低频采样与长期记录（实现完成，公网窗口待执行）

### 已交付范围

- `shared/source-quality-watchlist.ts` 固定 10 个代表来源，覆盖 RSS、JSON、HTML 和热榜入口；每个来源记录适配器类型和采样目的。
- `shared/source-quality-sampling.ts` 提供单来源采样函数。目标地址只接受 HTTPS；本地验收允许 localhost HTTP。请求不携带认证信息，单来源默认超时 20 秒，解码后响应上限为 2 MiB。
- `scripts/performance/source-quality-sample.ts` 提供显式启用的 JSONL 采样命令。默认每轮间隔 15 分钟，按来源顺序执行，追加目标 `origin`、`sampledAt`、状态、条目数、最新发布时间、新鲜度、耗时和错误原因。
- `shared/source-quality-window.ts` 和 `scripts/performance/source-quality-report.ts` 将 JSONL 汇总为按来源窗口报告，计算成功率、非空率、P50/P95 新鲜度，并保留未采样重点源。
- `shared/source-quality-policy.ts` 对窗口执行初始阈值判定，输出 `passing`、`insufficient-data` 或 `needs-attention` 及可读原因。当前初始阈值为至少 96 个样本、成功率 90%、非空率 80%、P95 新鲜度不超过 24 小时；阈值会随 7 天数据复核。
- 采样命令通过 `--origin` 或 `LATESTNEWS_QUALITY_SAMPLE_ORIGIN` 指定地址；默认不启动、不访问公网，也不写入版本库。

### 验证与证据边界

- `pnpm exec vitest -c vitest.config.ts run test/source-quality-sampling.test.ts`：通过，5 个测试覆盖地址校验、正常响应、HTTP 错误、响应体上限和超时。
- `pnpm exec vitest -c vitest.config.ts run test/source-quality-sampling.test.ts test/source-quality-window.test.ts`：通过，7 个测试覆盖采样和窗口汇总。
- `pnpm exec vitest -c vitest.config.ts run test/source-quality-policy.test.ts`：通过，5 个测试覆盖数据不足、通过、需要关注、P95 边界和缺失新鲜度。
- `pnpm typecheck`：通过。
- 新增文件定向 ESLint：通过。
- `pnpm source-quality:sample -- --help`：通过，命令帮助和默认参数可读。
- `pnpm source-quality:report -- --help`：通过，命令帮助和报告参数可读。
- 本切片没有执行公网采样。后续须使用明确授权的 HTTPS 部署地址，按 15 分钟或更长间隔运行至少 7 天，并保存运行提交、地址、时间窗口和错误记录。公网结果不作为本地代码测试通过证据。

### 回退边界

删除采样模块、命令、测试和本节文档即可回退；不改变来源 getter、缓存、健康 API、认证或桌面数据源配置。

## F5-A：采样窗口校验与记录追溯（实现完成）

- 质量报告同时检查默认 96 个样本和实际 7 天观察跨度，避免一天的数据因样本数量足够而显示达标。
- 采样记录增加运行 ID、Git 提交、工作区状态、Node 版本和调度参数；报告支持按地址和时间筛选，并标明缺少运行信息的旧记录。
- JSONL 解析校验状态、指标和运行信息。离线 CLI 测试使用本地 HTTP 服务验证采样、追加和报告流程。
- 用户指定地址 `https://news.likanug.top` 的首轮采样曾遇到 10 个接口 HTTP 500。部署修复后，第二轮 7 天观察已启动；当前记录见 [采样窗口计划](09-source-quality-window-plan.md)。
- 实现、验证、首轮记录及回退范围见 [采样窗口校验与记录追溯](09-source-quality-window-plan.md)。

## 当前下一步

F2-C、F2-D 已完成，F2-E 已完成入口核对。F3-A 已消除批量来源加载后的逐源重复请求，并启用路由自动代码分割。F3-B 的自动化生命周期探针、F3-C 的统一设置入口和 F3-D 的 Playwright Web/Electron E2E 基线已完成；桌面设置桥接、配置持久化和保存/刷新/恢复默认流程的单元与 E2E 覆盖已补充。F4-A Source SDK、F4-B 三类代表适配器迁移、F5-A 运行期质量指标、重点源采样工具、初始阈值判定及窗口校验已完成。

本地 Web 来源接口的 Day.js 加载问题和 Node 生产构建缺少前端入口问题已修复，见 [Web 接口运行时修复](10-web-api-runtime-fix.md)。Cloudflare Pages 的 Worker 模块布局、缓存导入和 PWA 预缓存问题见 [Worker 构建修复](12-cloudflare-pages-worker-fix.md)。后续生产日志确认的 Cheerio/Undici 初始化 HTTP 500 已由 `8b00a7b` 修复并部署。生产掘金、IT之家、v1 单源和批量接口均返回 HTTP 200，无效来源返回 HTTP 400，证据见 [新闻接口运行时修复](15-cloudflare-pages-source-runtime-fix.md)。部署健康接口仍报告缓存不可用，D1 持久缓存待单独配置核验；7 天采样已于 2026-10-25 启动，尚未完成，当前轮次和首轮结果见 [采样记录](09-source-quality-window-plan.md)。

用户提出的桌面本地采集方向已完成 [可行性评估](11-desktop-local-collection-assessment.md)。远端优先、网络或 5xx 回退本地、空地址仅本地模式和设置面板配置见 [桌面远端到本地采集回退](13-desktop-remote-local-fallback.md)；持久新闻缓存见 [独立实现记录](14-desktop-persistent-crawler-cache.md)；首批四个可信插件的构建预置、首次安装和已有配置保留见 [插件预置记录](16-desktop-builtin-plugin-plan.md)。本地来源详情、来源目录与采集健康回退已完成，见 [实现记录](19-desktop-local-source-details-health.md)。`remote/local/auto` 模式切换已实现并验证，见 [实现记录](20-desktop-collection-modes.md)；下一步推进托盘后台刷新。Windows 菜单与打包依赖修复见 [修复记录](17-desktop-menu-package-fix.md)。真实浏览器请求瀑布、真实 Windows 窗口证据和公网采样单独记录，不把 headless、进程输出或离线测试数据标为对应的真实环境通过。
