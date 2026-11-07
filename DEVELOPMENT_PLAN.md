# LatestNews 主线开发计划

更新日期：2026-11-07。代码审查基线：`main` / `origin/main` 的 `11f3aa9`。最新正式发布：`v0.7.5`（`0f53177`，2026-11-04）。

本文件是仓库唯一的开发计划。R1–R4 的代码修复已完成，R4 的真实窗口证据和 N1–N4 剩余验收继续保留。桌面自动更新已有 `v0.7.4` 的 Windows x64 升级证据，不能直接作为 `v0.7.5` 的安装验收。旧计划和详细实施日志通过 Git 历史追溯，不再新增独立计划或进度文档。

## 1. 目标和范围

目标是让现有 Web/PWA 和 Electron 能稳定完成“发现来源 → 关注 → 阅读 → 收藏或稍后读 → 历史回看”，并提高来源维护、故障定位和发布效率。

保留共用 React 前端、Nitro 服务端、可信插件宿主和当前持久化方式。已有能力以补充验收和修复具体缺口为主；新增交互必须对应明确的阅读或维护问题。公开插件市场、用户上传可执行插件、第三方 UI、代码签名、macOS 公证及语言重写进入条件性候选，不纳入 N1–N4。

### 桌面自动更新结果

2026-11-01 用户批准添加自动更新。使用本项目的 GitHub Release 和 `electron-updater`；不新增服务，不与其他项目共享运行时。默认自动检查，用户选择下载，并确认退出安装。Windows NSIS、macOS 更新 ZIP 和 Linux AppImage 尝试差分下载；缺少旧包、差分文件或 Range 支持时回退完整包。DEB 使用完整包。

验收：状态变化、设置持久化、取消和失败恢复通过测试；主进程只接受可信主窗口的固定请求；发布流程保存清单和差分文件，避免不同架构互相覆盖。执行 lint、类型检查、单元测试、Web/Electron 构建、相关 E2E、Windows 打包和真实窗口检查。签名、其他系统安装及正式发布升级分别记录证据。回退只撤销本项代码、依赖和发布配置，保留用户数据和旧版安装包。

2026-11-01 结果：lint、类型检查、428 项测试、Web/Electron 构建、8 项 Electron E2E 及 Windows NSIS 打包通过。原发布运行 `41259777389` 的 Docker 步骤取消后定向重跑，第二次运行的源码检查、六平台桌面包、Web 和 Docker 均成功。恢复运行 `41266229300` 核对相同标签提交，排除打包日志、合并多架构清单并完成[正式 Release](https://github.com/bruceblink/LatestNews/releases/tag/v0.7.4)，共 22 个资产。`SHA256SUMS.txt` 的 21 条摘要、更新清单引用和 GitHub 资产摘要全部一致。

Windows x64 集成使用本次源码构建的旧版本基线 `0.7.2`，并非旧官方安装包原已支持更新。在隔离目录完成自动发现 `0.7.4`、下载取消与重试、完整包回退。准备匹配的旧安装包缓存后，实际差分下载 10,642,003 字节，完整包为 139,733,951 字节，减少约 92.4%。重建包 SHA-256 为 `cb4864067d22fc1242a8d14293c5a30157bc718a099733eb333e256663d3b61a`，与正式资产一致。

普通退出仍保持旧版；开启托盘后台后，确认更新仍能退出并安装，NSIS 完成替换并自动重启到 `0.7.4`。安装器重启使用默认用户目录；随后显式使用原隔离用户目录启动，确认阅读历史、文件标记和 `autoCheck=false` 保留，手动检查返回无新版本。原始日志位于本机临时目录 `desktop-update-integration-20261101` 的 `latestnews-report`、`latestnews-restart-report`。这些结果只覆盖 Windows x64；签名、公证及其他系统安装未执行。

### 更新提示和 Web 更新

桌面端在主界面持续显示更新状态，并提供下载、取消和安装入口。Web 端在后台检查更新，用户保存输入后自行确认刷新。Node 和 Pages 构建均生成可访问的 Service Worker，并将应用入口加入离线缓存。验收包括静态检查、单元测试、桌面 E2E，以及两种生产构建的浏览器更新与离线重载测试。回退只撤销本项界面、更新注册和构建配置，不清理用户数据。

### 架构和兼容约定

| 范围 | 必须保留的行为 |
| --- | --- |
| Web/PWA 与 Electron | 共用 React 入口、路由、状态和 service；桌面加载安装包内资源，主进程不启动 Nitro HTTP 服务 |
| 采集部署 | Node/Docker 运行完整服务端采集和可信插件；Pages 使用兼容 Worker，动态配置型来源由 Node 执行 |
| 桌面采集模式 | `auto` 远端优先，仅网络/超时/5xx 等规定情况回退本地；401/403/429 和有效空结果保持原语义；`remote` 只读远端，`local` 只读已启用插件 |
| 缓存与数据 | Node SQLite、Pages D1、桌面采集缓存、浏览器离线快照分别管理；新闻缓存不替代收藏、历史和同步数据 |
| 插件与目录 | 只执行操作者审核过的 `trusted-js`；独立进程负责故障隔离，不能视为陌生代码沙箱；复用插件 ID、版本包和动态来源命名空间 |
| 采集执行 | Node 的统一引擎负责来源注册、单源请求合并、排队、输出规范化和健康回调；执行超时和缓存回退仍由适配器或 API 路由负责；生产取消链路尚未接通，Electron 仍使用独立插件 provider |
| 兼容与权限 | 保持既有来源 ID、URL/条目身份和 v1 API 兼容；桌面 IPC 只接收固定请求；新闻、认证、SyncHub 与联邦凭据分别管理 |
| 技术选型 | 继续使用 TypeScript、React、Vite、Nitro 和 SQLite/可选 D1；跨语言重写、Java BFF、多服务拆分、Redis/消息队列等待独立需求评估 |

已实现：有界调度与响应体限制、批量部分结果、动态来源目录、插件包安装/更新/固定/回退、四个桌面预置插件、桌面持久新闻缓存、可选托盘刷新、阅读状态和离线快照。维护这些行为时以源码及测试为准；已有实现不自动代表所有部署与原生窗口验收通过。

后续按切片独立回退。持久化变更先验证迁移和旧版兼容，不通过清空用户数据恢复旧版本。

## 2. 核对结果

| 项目 | 当前核对结果 | 证据和限制 |
| --- | --- | --- |
| 正式发布 | `v0.7.5`，2026-11-04 21:05（UTC+8）发布，共 22 个资产 | 2026-11-07 只读核对 GitHub Release 元数据和资产名称；本轮未下载、复算摘要或验证升级，不沿用 `v0.7.4` 的产物验收结论 |
| 发布后主线 | 从 `v0.7.5` 的 `0f53177` 快进到 `11f3aa9`，修复动态目录、健康分类和桌面渲染恢复 | 本轮同步远端后提交 `3a63029`、`11f3aa9`；未创建新标签或 Release |
| 历史发布 CI | `v0.7.4` 的标签源码、六平台桌面包、Web、Docker 和恢复发布已有通过记录 | [原构建](https://github.com/bruceblink/LatestNews/actions/runs/41259777389)、[恢复发布](https://github.com/bruceblink/LatestNews/actions/runs/41266229300)；本轮不查询或监测 CI，不据此判断当前提交的 CI 状态 |
| Electron 版本 | 当前依赖声明为 `44.9.0` | 历史 Windows 构建和 NSIS 打包已通过；本轮只做类型检查与测试，不代表重新运行打包程序 |
| 许可和校验和 | 当前有模块说明、产物复制步骤和 `SHA256SUMS.txt` 生成流程 | `v0.7.4` 已有核对记录；`v0.7.5` 本轮只确认资产名称，摘要与实际许可文件仍应按版本分别验证 |
| UI 自动化 | 有搜索框居中、安装引导、移动布局、设置与采集模式覆盖 | Web 页面用例大量使用固定 API 响应；另有真实本地 Nitro 目录、健康和无效 ID smoke |
| 端到端缺口 | 真实认证与 SyncHub、动态目录慢网/断网重启、浏览器直连 Docker Node 服务仍待验收 | N2-A/N2-B 已有阅读状态和 Electron 不注册 Service Worker 的历史 E2E 记录；不把这些结果列为本轮重测，也不代替未完成流程 |
| 插件宿主 | 本地 Electron host smoke 和 2026-11-06 本地 Docker 动态来源 API smoke 已有通过记录 | 历史 CI 运行 `41749640773` 的两个 host smoke 成功；最近一次本机 Electron 重跑受二进制下载限制，本轮未复测 |
| 爬虫执行引擎 | Node 三类适配器共用 `SourceEngine`；取消只在引擎/队列接口和测试层存在 | 真实 API 不传 `signal`，生产适配器不转发 `SourceExecutionContext.signal`；不能标为端到端取消完成，具体范围见 N3-A |
| 配置型来源 | RSS/JSON 清单、停用来源、目录快照和使用固定测试响应的阅读 E2E 已实现 | 本轮复现启动快照不可读及目录晚到导致状态不同步；必须先修复 R-A，再进行 N3-C 的真实组合流程 |
| 历史观察 | 七天公网采样已按用户要求延后；历史记录不足以判定来源达标 | 恢复条件见第 8 节；本轮未探测生产新闻接口或 D1 状态 |

许可证范围见 [LICENSE.md](LICENSE.md)。N1-B 核对声明、代码来源和实际产物是否一致，不把已有说明视为完整的依赖许可审查。

待验收事项继续保留：真实登录与 SyncHub、原生托盘菜单的完整操作、Windows 安装后图标与卸载、macOS/Linux 实机、动态源完整阅读流程、D1 持久化和来源质量观察。2026-10-24 的 Pages 新闻 API 修复已取得生产单源/批量 HTTP 200 及无效来源 HTTP 400 证据，但当时 D1 缓存仍不可用；这是历史结果，本轮未核验生产接口或 D1 当前状态。2026-10-25 记载的采样窗口快照为 12 轮、120 条记录，10 个来源的报告均为样本不足；恢复前需重新核对原始 JSONL，不能据此认定来源达标。

### 2026-11-07 代码审查

本轮重点审查 `0f53177..84fba9f` 的变更及其前端状态、采集宿主和桌面窗口调用链。R1–R4 的代码修复已在 `3a63029` 完成，测试 mock 在 `11f3aa9` 补齐；R4 仍缺真实窗口注入证据。本轮不是完整安全审计。

1. **R1 / P1：启动时没有读取动态来源快照（已修复）。** `src/main.tsx` 已将缓存键移到启动调用之前，并在导入路由和状态模块前等待有界的目录初始化。保留目录失败时的内置来源回退；离线快照、目录启动时序仍需真实浏览器重启证据。
2. **R2 / P1：目录晚到会丢失当前关注项，发现列表也不更新（启动顺序已修复）。** `src/main.tsx` 现在在路由、atom 和搜索组件导入前等待目录初始化，避免动态来源关注项在初始化时被过滤。目录运行期间的后续热更新仍未设计为实时刷新，真实延迟目录与同一用户目录重启仍待验收。
3. **R3 / P2：执行器筛选漏掉未采样来源（已修复）。** `server/utils/source-health.ts` 现在从已加载的运行时适配器识别插件/配置型来源，静态来源在 idle 状态标记为 `legacy`，不会触发采集。新增 idle 分类回归测试；真实运行时目录和页面筛选仍需环境验收。
4. **R4 / P2：桌面渲染进程崩溃后不能通过唤醒恢复（代码已修复，窗口证据待补）。** `electron/main.ts` 现在对主窗口 `render-process-gone` 执行一次受保护的重载，重载失败时销毁并重建窗口，同时保留原可见/最小化状态；退出、更新安装和认证窗口不触发恢复。尚未注入真实 renderer 崩溃。

另有两项限制，不作为已确认的生产回归：取消信号尚未接入真实请求及生产适配器；桌面缓存写入失败只记录警告、仍返回采集成功，这是当前的尽力保存行为。前者纳入 N3-A 的接口约定和真实链路验收；后者纳入 N3-B 的不可写目录、重启和旧缓存测试。不要把缓存写失败直接记为采集失败，也不要在未定义含义前改变 `cacheDegraded`。

### 2026-11-07 验证记录

环境：Windows，Node `24.15.0`，pnpm `12.16.1`。Node 满足 `engines` 最低要求，但不是 `.nvmrc` 的 `22.23.4`；这次结果不补足精确版本验收。

| 检查 | 本轮结果 |
| --- | --- |
| `pnpm lint:check` | 通过，退出码 0 |
| `pnpm typecheck` | Node 与应用类型检查通过，退出码 0 |
| `pnpm typecheck:electron` | 通过，退出码 0 |
| `pnpm test --run` | 修复后 83 个测试文件、436 项测试通过；有 `SourceAdapterKind` / `SourceDescriptor` 重复自动导入提示，未导致失败 |
| 修复范围 | `3a63029` 修复启动目录等待、idle 执行器分类和 renderer 重载；`11f3aa9` 补齐配置型来源测试 mock |
| 构建与 Web E2E | `LATESTNEWS_SKIP_FAVICON_FETCH=true pnpm build` 通过；Web E2E 19 个用例中 17 个通过、2 个按既有 Service Worker 条件跳过 |
| 启动与窗口限制 | R1/R2 真实离线重启、R4 renderer 注入崩溃和 Docker 组合流程仍未执行 |
| 文档检查 | UTF-8、LF、Markdown 解析、章节编号、8 个仓库相对链接及 `git diff --check` 通过；只修改本计划 |

修复后 Node/App/Electron 类型检查、lint、全量单测和生产构建均通过；Web E2E 已回归。Node `22.23.4` 精确版本、Electron 真实窗口、Docker 组合、生产探测、依赖升级和 CI 监测仍未执行。`R4` 只有代码路径验证，不能替代真实 renderer 崩溃注入。

## 3. 顺序、依赖和版本

| 阶段 | 用户或维护者得到的结果 | 依赖 | 建议版本 | 工作量 |
| --- | --- | --- | --- | --- |
| R 审查修复 | 动态目录重启保留关注，未采样来源可筛选，桌面坏窗口可恢复 | 当前审查；按 R-A → R-B → R-C 顺序 | 下一 `v0.7.x` 候选 | 2–4 日，含回归，实施前复估 |
| N1 发布与桌面稳定性 | 能验证下载、安装、升级、托盘与对应版本源码 | 当前主线 | 后续 `v0.7.x` | 3–4 日 |
| N2 阅读、离线与同步 | 跨页面状态一致，断网、重启和同步失败可恢复 | N1；外部服务验收可单独等待 | `v0.8.0` | 4–6 日 |
| N3 来源维护与插件验收 | 统一来源执行边界；同一来源在目录、阅读、保存与宿主切换中可维护 | N2 的状态兼容验收；宿主 CI 可提前执行 | `v0.8.x` | 5–7 日 |
| N4 性能预算与回归 | 当前版本有可重复的性能数据和预算检查 | N1 固定环境、N2/N3 代表流程 | `v0.8.x` | 3–4 日 |
| N5 独立采集插件试点 | 有真实需求的适配器可以独立升级与回退 | N3 通过且满足第 8 节条件 | `v0.9.0` 候选 | 另行估算 |

表中 N1–N4 保留原阶段估算，不表示仍需重复投入这些工时。R 修复与剩余验收按第 10 节重新安排，不把已通过的历史检查重复列为开发任务。每个切片允许拆成补丁发布；不为凑版本扩大范围。Web 可随已验证提交独立部署，桌面变更通过新安装包交付。公网七天观察和其他操作系统实机等待单列。

## 4. N1：发布与桌面稳定性

### N1-A：统一发布输入与运行版本

文件入口：`package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、`.nvmrc`、`electron-builder.yml`、`electron.vite.config.ts`、`.github/workflows/`。

- 统一 Electron 依赖声明、安装程序实际运行时和 E2E 运行时；记录最终版本和平台，清理本机回退版本造成的验收歧义。
- 执行时查询 Vite/pnpm 官方最新稳定版本、Vite Node 要求与插件兼容范围。任一过时则同一维护切片更新两者；已是最新的组件记录核对结果。同步清单、`packageManager`、锁文件、CI 和开发说明。
- 确认干净安装可执行 lint、类型检查、构建与现有 E2E；不依赖临时 `pnpm` shell 映射才能提交。

验收：声明、锁文件、打包程序版本和 CI 运行环境可核对；最小 Electron 包能启动，现有外部依赖检查通过，Web/Pages 和 Electron E2E 通过。

回退：撤回本切片的工具链与构建配置变更，恢复上一组已验证依赖；不改业务数据格式。

2026-11-03 核对结果：官方 npm 注册表的稳定版为 pnpm `12.16.1`、Vite `8.3.5`。根 `package.json`、锁文件、Release/Electron/E2E/Nightly 工作流和 README 已统一到 pnpm `12.16.1`；GitHub Actions 与 `.nvmrc` 已统一使用 Node `22.23.4`。Vite 的 Node 要求为 `^20.19.0 || >=22.12.0`，与项目 Node 最低版本 `22.23.0` 兼容。已用 pnpm `12.16.1` 完成锁文件解析和供应链策略检查；干净安装、代码检查、构建和 E2E 仍待执行。

2026-11-04 检查结果：使用 pnpm `12.16.1` 完成冻结锁文件安装、全仓库 lint、Node/应用/Electron 类型检查、Node 生产构建和 Pages 构建。Pages 构建新增包装器，构建期间使用 Pages 来源清单，结束后恢复已跟踪的生成文件；成功和失败路径均保留构建前内容。新增静态 Web 生产构建入口供 PWA E2E 读取 `index.html`；本机 Node `24.15.0` 下 Web Chromium E2E 为 17/17、Electron E2E 为 10/10 通过。随后使用便携 Node `22.23.4` 和 pnpm `12.16.1` 重新完成冻结安装、lint、两项类型检查、Node 构建和 Pages 构建，全部退出码为 0。Node 22 下的 Windows x64 NSIS 包也已生成。远端发布运行 `41259777389` 的 Windows x64、Windows ARM64、Linux x64、Linux ARM64、macOS Intel、macOS Apple Silicon、Web 和 Docker 构建 job 均成功；发布运行 `41266229300` 成功复用这些产物。两组构建均有 4 个外部图标请求超时并使用已有默认图标。

2026-11-04 发布准备结果：CI 修复已合入主线，发布候选版本提升为 `0.7.5`。`77789db` 保留 crawler smoke 的显示环境，`c446b87` 修复 Web E2E 在 CI 中使用相对 `dist` 根目录导致的 Service Worker MIME 错误，`4f379c6` 及后续清理修复 Electron worker teardown 超时。发布前的本地 Node `22.23.4` 检查和远端 E2E 已覆盖这些修复。

2026-11-04 CI 结果：`Playwright E2E` run `41749640773`（head `4f379c6`）的 `Crawler host smoke` job `126311256699`、`Web Chromium E2E` job `126311256886` 和 `Electron E2E` job `126311256976` 全部成功；Web 为 17/17，Electron 为 10/10。`Electron desktop` run `41749640707` 的 `Build and check Windows desktop` job `126311256489` 成功。此前 Electron worker 在测试通过后超时；`77789db` 修复 crawler 的显示环境，`c446b87` 修复 CI 静态 `dist` 根目录解析，`4f379c6` 在进程组和 stdio 管道层完成 Electron 清理，最终运行没有 teardown 超时。

2026-11-07 发布状态校正：GitHub Release 列表与 `v0.7.5` 详情均显示该版本已于 2026-11-04 正式发布，非草稿、非预发布，共 22 个资产。标签指向本地提交 `0f53177`。本轮只核对元数据和资产清单，未执行下载摘要检查、容器连接或 `v0.7.5` 升级；README 仍写 `0.7.2` 和仅安装包更新，后续发布文档切片应校正。本轮按用户要求只提交开发计划。

### N1-B：验证发布产物、许可和版本源码入口

文件入口：`LICENSE.md`、`LICENSES/`、`scripts/prepare-electron-package.mjs`、`scripts/verify-license-bundle.mjs`、`scripts/verify-electron-dependencies.mjs`、`.github/workflows/release.yml`、`Dockerfile`、`src/components/footer.tsx`。

- 检查 Electron 包、Web ZIP 和 Docker 镜像中的范围说明与完整许可证文本。核对文件历史、原许可证、贡献者和复用代码的授权，以及第三方声明。涉及的授权无法确认时，记录具体范围，并在确认前保持发布事项待完成。
- 检查桌面主进程、renderer、worker 和预置插件的实际构建输入；许可范围应与进入产物的代码一致。
- 为每个桌面包和 Web 包生成 `SHA256SUMS.txt`，重新计算并核对；校验和文件不包含自身。用户下载说明链接到同一标签的源代码和构建说明；源码入口不能只指向随时变化的 `main`。
- 在 Electron staging 目录和 Web 发布目录核对完整许可证文件的 SHA-256；桌面包附带带版本标签的 `README.txt`，Web 包附带同样的源码和部署文档入口。Docker 最终镜像在构建阶段检查四份许可证文件存在且非空。
- 保留从标签提交范围生成双语发布说明的流程；发布后核对桌面资产、Web 包、Docker 版本标签与摘要。

验收：许可证路径及内容可在实际产物中读取；摘要全部匹配；版本、变更范围和源码链接一致。已有 `v0.7.2` 标签与资产保持原状，改进从下一版本生效。

回退：撤回新增的检查或复制逻辑；保留已发布文件和对应版本源码，不改写旧标签。

2026-11-04 本地产物结果：运行 `corepack pnpm@12.16.1 electron:build` 后，`node scripts/verify-license-bundle.mjs out electron` 和 `node scripts/verify-electron-dependencies.mjs out` 均通过。`out/package.json` 标记 `GPL-3.0-only`，主入口为 `main/main.cjs`；4 个外部图标请求超时并使用已有默认图标。远端发布运行已核对六平台桌面产物、Web 发布 ZIP、摘要合并和 Docker 构建 job。

2026-11-04 Node 22 Windows 结果：在 Node `22.23.4`、pnpm `12.16.1` 下完成 Electron staging 和 NSIS 打包。`release/validation-node22/LatestNews-0.7.4-Windows-x64.exe` 大小为 139,723,981 字节，并生成对应 blockmap 与 `latest.yml`；清单中的版本为 `0.7.4`，安装包 SHA-512 已写入更新清单。未配置代码签名证书，Windows 包和卸载程序保持未签名。远端 `v0.7.4` 发布包含 22 个资产，21 个资产条目与 `SHA256SUMS.txt` 全部匹配。

2026-11-04 Node 22 Web 结果：在当前 `main` 的 Node `22.23.4`、pnpm `12.16.1` 下运行 `pnpm build` 并按发布工作流打包，生成 152 个条目的临时 Web 包，大小为 10,657,890 字节，SHA-256 为 `43e7b1f943f2744ff9be6f20f295dd1f0c7c27ad9a027deb7707edd8b1559031`。运行 `node scripts/verify-license-bundle.mjs` 通过，包含 Node server、静态资源、版本 README 和完整许可证束；4 个外部图标请求超时并使用默认图标。

2026-11-04 发布产物结果：下载 `v0.7.4` 的 `LatestNews-0.7.4-Web.zip`，大小为 10,423,425 字节，SHA-256 为 `2178a73066ebfb93fc2cae4ae8f25e6b40a4dc2eb83f54b83d8915273a2a7c69`。解压后运行 `node scripts/verify-license-bundle.mjs` 通过，包含 `LICENSE`、`LICENSE.md` 和两份 `LICENSES/*.txt`；包内 README 使用版本标签源码链接和 Node 22 启动入口。Docker 镜像构建 job 已成功；当次 Windows 会话未找到 Docker 命令且未核验 WSL，未完成镜像拉取或容器连接，不能据此判断本机 Docker 不可用。

2026-11-04 Docker 清单结果：远端 GHCR `ghcr.io/bruceblink/latestnews:v0.7.4` 可读取，OCI 索引摘要为 `sha256:5b1c478a72f6337201e5710fc9e94be57c86280e9679eaf13c421be30ca99422`，包含 `linux/amd64` 和 `linux/arm64`。当次未核验 WSL，容器启动、健康检查、接口连接和清理未执行；后续本地 Docker smoke 见下条记录。

2026-11-06 Docker 环境与 smoke 结果：Docker Engine `28.4.0`、Buildx `0.31.0` 和 Compose `2.40.3` 已可用。项目 Docker 构建增加可选 BuildKit CA secret、代理参数和锁定 pnpm 安装，解决透明代理环境下 Alpine `apk` 与 Corepack 的证书/网络问题。`corepack pnpm test:crawler:docker` 构建镜像、启动容器并验证动态来源 API、目录、详情、批量、JSON Feed、CORS 和未知来源拒绝全部通过；测试结束后临时容器和镜像已清理。

### N1-C：Windows 安装、升级与托盘验收

文件入口：`electron/main.ts`、`electron/background-refresh.ts`、`electron/desktop-preferences.ts`、`electron-builder.yml`、`electron-e2e/`。

使用隔离安装目录和测试用户目录，通过 Computer Use 检查新装、从 `v0.7.2` 覆盖升级、任务栏/快捷方式图标、按 Alt 不出现菜单、关闭到托盘、原生托盘菜单恢复/刷新/退出、再次启动及卸载。

验收：关注、收藏、历史、API 地址、采集模式及本地缓存按设计保留；完全退出后没有遗留 worker；默认关闭托盘模式的行为正确。记录实际后台刷新结果；无法访问上游时分别验证错误反馈和已有缓存，不记成采集成功。

macOS/Linux 的构建与真实安装分别记录。缺少设备时列出平台和缺口，由维护者判断发布范围；不能使用跨平台 CI 代替实机结果。

回退：仅修正本切片的窗口或安装行为；保留用户目录和旧安装包，先验证数据兼容再覆盖安装。

2026-11-04 部分结果：当前提交构建的 `0.7.4` Windows x64 包在隔离用户目录中启动。真实窗口可打开设置并保存 `desktop-preferences.json` 中的 `trayBackgroundEnabled: true`；关闭窗口后主进程继续运行，再次启动同一用户目录可恢复窗口。NSIS 安装器可以进入隔离目标目录，但自动启动时检测到另一份正在运行的 LatestNews；为保护已有实例，未确认关闭旧实例，安装、从旧包覆盖升级、任务栏和快捷方式图标、原生托盘菜单直接操作及卸载仍未完成，不能据此关闭 N1-C。

## 5. N2：阅读、离线与同步

### N2-A：完成共享阅读流程

文件入口：`src/components/common/search-bar/`、`src/components/column/`、`src/routes/feed.tsx`、`src/routes/source.$sourceId.tsx`、`src/routes/history.tsx`、`e2e/`、`electron-e2e/`。

围绕发现与关注、Feed 筛选、来源详情、收藏/稍后读、历史搜索和返回导航补齐流程。已有历史搜索和导出继续复用。重点检查模态框位置、内部滚动、关闭后的焦点、移动导航、空结果、部分失败、旧缓存和重试反馈；只修改检查中确认的缺口。

验收：Web 和 Electron 均能从发现来源走到历史回看；关注和阅读状态跨页面一致，重启后保留。Feed 筛选、重置、刷新和前进/后退恢复一致，加载更多无重复条目。桌面和窄屏检查无横向溢出；键盘可打开、选择和关闭模态框。自动化使用稳定测试数据，真实窗口证据单独保存。

2026-11-03 实现结果：上游 `600589e` 已让 Feed 筛选写入路由搜索；本地 `3277b8c` 继续让输入框、下拉框、重置按钮和侧栏筛选先更新受控状态，再异步更新路由，避免快速操作时界面回退或丢失输入。跨页面、重启、窄屏和真实窗口验收仍待执行。

2026-11-04 Web 验收结果：使用静态生产构建和本地 Nitro 开发服务运行 `corepack pnpm@12.16.1 test:e2e:web`，15 个 Chromium 用例全部通过，覆盖 Web shell、设置、历史空状态、移动 Feed 筛选、导航链接、安装引导和浏览器更新提示。来源详情到历史回看、重启持久化和 Electron 真实窗口流程仍待验收。

2026-11-04 Electron 验收结果：运行 `corepack pnpm@12.16.1 test:e2e:electron`，10 个用例全部通过，覆盖原生菜单栏隐藏、内置来源发现、设置路由、更新状态、API 地址、`auto`/`remote`/`local` 采集模式，以及本地 API 服务下来源详情到历史回看、稍后读、收藏、刷新和同一用户目录重启后的历史持久化。

2026-11-04 阅读流程结果：新增 `e2e/reading-flow.e2e.spec.ts`，使用稳定来源响应验证来源详情条目点击、历史记录、稍后读和收藏在 `/history` 页可见，并在刷新后保持。该用例已纳入完整 Web E2E，16 个 Chromium 用例全部通过；Electron 真实窗口的同一流程仍待验收。

### N2-B：验证 PWA 更新与离线恢复

文件入口：`src/hooks/usePWA.ts`、`src/services/offline-reading-state.service.ts`、`src/services/offline-feed-snapshot.service.ts`、`shared/offline-reading-state.ts`、`shared/offline-feed-snapshot.ts`、`pwa.config.ts`。

验证在线缓存后断网、离线重载、进程重启、恢复网络和 Service Worker 更新。区分离线新闻列表、收藏/历史元数据与外部文章正文；现有快照不承诺全文离线。复用当前数量、版本与有效期限制，检查存储写入失败和过期提示，不先替换存储技术。

验收：断网可读取已有快照，缺少数据时说明原因；恢复网络后更新但不清空本地阅读状态。PWA 更新后旧快照可兼容读取或明确失效；Electron 不注册 Web Service Worker。

2026-11-03 实现结果：`90909de` 让 PWA 更新成功标记在受限或禁用 `localStorage` 时安全读取和清理，更新后的启动流程不会因存储异常中断。离线重载、Service Worker 更新、过期快照和 Electron 隔离仍需浏览器与真实窗口验收。

2026-11-03 继续结果：本次切片让 Feed 快照读取区分新鲜、过期和无效状态。过期快照只用于显示保存时间和原因，不再作为当前 Feed 内容渲染；新鲜快照继续支持断网展示。浏览器离线重载、Service Worker 更新和 Electron 隔离仍未执行，回退边界为撤销本次离线快照状态代码。

2026-11-04 验收结果：新增 `build:web:test` 静态 Web 构建入口，复用 Web renderer 和 PWA 插件但跳过 Nitro 输出，生成可由测试服务器直接提供的 `dist/index.html` 与 `dist/swx.js`。Web E2E 已验证等待更新时保留未保存输入、接受更新后离线重载，相关用例通过；真实 Feed 快照离线恢复和 Electron 不注册 Service Worker 的窗口证据仍待执行。

2026-11-04 浏览器离线结果：新增 `e2e/offline-feed.e2e.spec.ts`，使用静态生产构建在线加载 Feed 并写入快照，再通过 Service Worker 离线重载确认条目和“当前展示 Feed 快照”提示仍可见；随后将保存时间推进 8 天，确认过期条目不再渲染并显示过期提示。该用例已纳入完整 Web E2E，17 个 Chromium 用例全部通过；Electron 不注册 Service Worker 的窗口证据仍待执行。

2026-11-04 Electron 隔离结果：在真实 renderer 启动前拦截 `ServiceWorkerContainer.register`，reload 后调用次数为 0；该断言随 10 个 Electron E2E 用例通过。关闭并重新启动同一用户目录后的阅读历史也保持。Electron 不注册 Web Service Worker 的窗口证据已完成。

### N2-C：验证认证与 SyncHub 恢复流程

文件入口：`src/hooks/useLogin.ts`、`src/hooks/useSync.ts`、`src/hooks/useSyncHub.ts`、`src/services/metadata.service.ts`、`src/services/synchub.service.ts`、`electron/synchub-storage.ts`。

使用独立测试账户和本地 Docker 中的真实服务验证登录取消、过期、退出、两端布局同步、收藏/历史合并、冲突、离线更改和失败重试。记录服务镜像/版本、端口、启动和清理。未取得服务镜像或测试配置时，只执行可独立验证的本地状态与错误流程，保留真实集成缺口。

验收：认证或同步失败不覆盖本地更改；重试不会重复写入或丢失已保存内容；新闻 API、认证服务和 SyncHub 使用各自配置与凭据。生产服务可用性另作只读核验，不能代替本地 Docker 集成。

现有收藏按 URL 并集合并，尚无跨设备删除传播约定。先用两端删除、再次收藏、离线旧设备回归和旧客户端场景确认产品行为，再决定是否增加删除标记、保留期限和版本迁移。需要 SyncHub 服务变更时单独估算，不把本地删除等同于远端删除成功。

N2 回退：按页面、PWA 更新或同步切片分别撤回。若确需修改持久化格式，先提供版本迁移、测试数据和旧版读取结果，再发布；不与视觉改动混合。

## 6. N3：来源维护与插件验收

### N3-A：统一爬虫执行引擎

文件入口：`server/utils/source-fetch.ts`、`server/utils/source.ts`、`server/utils/crawler-plugin-runtime.ts`、`crawler-platform/sdk/`、`crawler-platform/host/`、`server/configured-source-runtime.node.ts`、`shared/news-item-schema.ts`。

现有 `SourceEngine` 使用 `SourceAdapter`、`SourceDescriptor` 和 `SourceExecutionContext`，负责 Node 来源注册与冲突处理、单源请求合并、队列、`NewsItem` 规范化和健康回调。执行超时仍由各 runtime 负责，缓存回退仍在 API 路由中；不为补齐类型名称新增没有使用者的 `SourceResult`。

当前 Node 接入三类适配器：

- 传统来源适配器包装现有 `getters[id]`，保留全部传统来源代码和现有 URL/条目 ID。
- 插件适配器包装 Node 插件 provider，继续使用清单预算、网络 broker、进程隔离和 `trusted-js` 边界。Electron 直接使用插件 provider，不声称已经接入同一个 `SourceEngine`。
- 配置型来源适配器包装 RSS/JSON runtime，继续保留 HTTPS、主机 allow-list、DNS 固定和私网地址拒绝。

不把插件安装、版本回滚、配置清单、Node/Electron 宿主和业务来源解析混进同一个接口；适配器负责描述来源和执行采集。保持现有来源 ID、缓存键、`NewsItem.extra`、远端/本地回退语义和 Pages 能力边界。

尚未完成的取消链路：生产路由只调用 `fetchSourceItems(id)`，Node 适配器也没有把 `SourceExecutionContext.signal` 交给插件或配置型 runtime。先明确同源请求合并时的调用方取消规则，再补真实适配器的超时/停止测试；不能把一个调用方断开直接等同于取消其他调用方共享的任务。是否绑定 HTTP 断连按真实需求决定，不因已有队列接口而默认扩大范围。

验收：

- 传统 getter、插件和配置型来源通过同一个引擎入口执行，输出来源 ID、URL、条目 ID、发布时间和 `extra` 与迁移前一致。
- 单源并发合并、队列上限、取消、超时、错误状态、健康记录和缓存回退在三类适配器上使用同一套规则。
- Node 与 Electron 对同一插件包保持一致输出和资源限制；配置型来源的 DNS/HTTPS 安全检查不被通用抽象绕过。
- 至少覆盖 RSS、JSON API、HTML 三个代表来源；暂不迁移其余传统来源，不改变来源专属业务逻辑。

回退：按独立修复提交撤回引擎或适配器变更，保留插件 provider、配置型 runtime、来源数据和缓存。当前没有来源级切换开关，不把尚不存在的开关作为恢复手段。

2026-11-06 实现与验收结果：`6ba466a` 建立统一 `SourceEngine` 执行边界，`c5b900d` 增加 `legacy`/`plugin`/`configured` 分类，`0e34cc8` 分离插件 provider 与配置型 runtime 的执行入口，`fb66e9f` 增加来源注册表和插件优先替换传统 getter 的规则，`665e371` 增加注册、冲突、规范化和并发合并契约测试，`9ec533f` 让共享任务队列支持等待取消、运行中 abort，并避免取消被记录为来源失败。当前引擎统一处理单源请求合并、任务队列、取消、输出规范化、质量统计和健康回调；Node、应用和 Electron 类型检查通过，生产 Web/Nitro 构建通过，全量 Vitest 为 83 个测试文件、433 个测试通过。RSS/JSON 配置 runtime、HTML/RSS/JSON 插件仍保留各自网络和宿主安全实现，代表性来源迁移对比与 Docker/真实宿主验收继续留在 N3-B/C。

2026-11-06 适配器可观测性结果：`44b3a46` 将 `SourceAdapterKind` 与 `SourceDescriptor` 提取到共享契约，首次执行时把 `legacy`、`plugin` 或 `configured` 写入来源健康快照；健康列表、来源详情和文本诊断报告均显示执行器类型，旧快照兼容显示“待识别”。新增引擎回调、健康记录和诊断格式测试；全量 Vitest 83 个测试文件、433 个测试通过，Web 全量 E2E 16/18（2 项按既有 Service Worker 条件跳过）。

2026-11-06 运维筛选结果：`eb7b8d8` 为 v1 健康接口增加 `adapterKind=legacy|plugin|configured` 筛选，健康页面增加执行器筛选和重置交互，Electron 本地插件健康摘要统一标注为 `plugin`；OpenAPI、API 文档、共享筛选逻辑及 Web/Electron 回归测试已同步。全量 Vitest 83 个测试文件、435 个测试通过，Web E2E 19 个用例中 17 个通过、2 个按既有 Service Worker 条件跳过。

### N3-B：完成插件宿主验收

文件入口：`crawler-platform/sdk/`、`crawler-platform/host/`、`crawler-platform/runtime/`、`scripts/crawler/`、`.github/workflows/e2e.yml`、`.github/workflows/electron-desktop.yml`。

将现有 `pnpm test:crawler:electron` 与 `pnpm test:crawler:docker` 接入适合的平台 CI。补充同包输出、超时、超大响应、取消、进程退出、损坏包和回退场景，保存插件版本、包 SHA-256、资源上限和清理结果。独立进程的职责是隔离故障；当前 `trusted-js` 继续只运行维护者审查过的代码。

2026-11-03 实现结果：`.github/workflows/e2e.yml` 新增 `Crawler host smoke` job，在 Ubuntu 24.04 中安装 Electron 运行时、Xvfb 和 Docker，依次执行 `pnpm test:crawler:electron` 与 `pnpm test:crawler:docker`，并上传两份运行报告。首次 CI 运行结果、资源指标和清理记录仍待观察。

2026-11-04 验收结果：首次执行 `corepack pnpm@12.16.1 test:crawler:electron` 时发现 `server/crawler-plugin-runtime.node.ts` 使用无扩展名 `.node` 导入，Node `24.15.0`/`tsx` 无法解析实际的 `.node.ts` 文件；改为显式 `.node.ts` 后重跑通过。Node 与 Electron 对同一插件包及动态插件输出的 SHA-256 一致，Node 用时 236 ms、Electron 用时 350 ms，检测到 Browser、GPU、NetworkService 和 NodeService，测试结束无残留 Electron 进程。Docker smoke 和 CI 运行记录仍待执行。

2026-11-04 Docker 结果：执行 `corepack pnpm@12.16.1 test:crawler:docker` 在构建镜像前以 `spawnSync docker ENOENT` 失败。当次 Windows 进程未找到命令，未检查 WSL 发行版或 Docker 服务；该历史结果不代表本机 Docker 不可用，也不代表宿主代码通过或失败。

2026-11-04 CI 结果：`Playwright E2E` run `41749640773` 的 `Crawler host smoke` job `126311256699` 成功，Electron 和 Docker host smoke 均完成且报告已上传；本机 Docker 容器启动、连接和清理仍待具备 Docker 环境后执行。

2026-11-06 本机重跑结果：`corepack pnpm@12.16.1 test:crawler:electron` 在 Electron `44.9.0` 二进制下载阶段因网络 `fetch failed` 终止，未产生新的本机 smoke 证据；不改变此前 CI 的 Node/Electron 同包对比结论。

2026-11-06 Docker smoke 结果：Docker 镜像构建和动态来源 API smoke 已通过，覆盖动态来源条目、目录、详情、批量、JSON Feed、配置 CORS、拒绝未配置 Origin 和未知来源；测试清理了临时容器与镜像。

验收：Node/Electron 加载同一插件包并得到一致有效输出；插件失败不阻塞内置或远端可用来源；任务停止后没有遗留进程。Docker 验收使用本地实际容器，进程 smoke 与真实窗口结论分别记录。凭据引用和新重试协议等新增能力等 N5 有需求后再设计。

### N3-C：动态来源与配置型来源的完整流程

文件入口：`server/configured-source-runtime.node.ts`、`shared/runtime-source-catalog.ts`、`src/services/source.service.ts`、`crawler-platform/cli.ts`、`docs/deployment.md`。

在本地 Docker Node 服务中配置一个 RSS 和一个 JSON 来源，以真实浏览器验证来源发现、关注、Feed、详情、收藏、历史、停用/重启和同步。分别检查同源部署与 Pages 风格静态前端指向 Node API 的 CORS 配置；Edge 不承担任意 URL 配置源执行。

配置型来源当前拒绝私网地址。先设计本地 HTTPS 测试服务的连接方式，不放宽生产网络校验。若需要在测试进程中注入 DNS 或传输，将实际请求送至隔离容器，并单独验证生产校验的拒绝行为；注入路径不能证明生产 DNS、TLS 或公网部署通过。

验收：客户端无需修改来源专属代码即可显示动态来源；停用或目录暂时不可用时保留已保存文章和布局记录。Node 的运维清单与 Electron 本地插件分别生效；更改远端 API 不覆盖本地插件版本。同步验证依赖 N2-C 的服务条件；缺少服务时记录已完成流程和同步缺口，不将完整验收标为通过。

2026-11-06 本地流程结果：配置型来源的 RSS/JSON 清单、来源目录、来源详情、单源条目、批量接口和 JSON Feed 已由 `server/configured-source-api.integration.test.ts` 覆盖，并随全量 83 个测试文件、435 个测试通过；动态目录快照、停用来源保留和目录暂时不可用回退已由 `a0b7a80`、`f1b6afc` 实现。真实浏览器、Docker Node 服务、跨页面关注/收藏/历史和同步仍待对应环境验收。

2026-11-06 Web 流程结果：新增 `e2e/configured-source-flow.e2e.spec.ts`，使用稳定动态来源 API fixture 验证目录、来源详情、条目阅读、稍后读、收藏和历史回看，Chromium 1/1 通过。该用例证明客户端不依赖来源专属前端代码；浏览器直连 Docker Node 服务和 SyncHub 仍待独立环境验收。

2026-11-06 Web 全量回归：`corepack pnpm test:e2e:web` 共发现 18 个用例，16 个通过，2 个按既有 Service Worker 更新环境条件跳过；动态来源流程、Feed 筛选、离线、安装引导、阅读状态和更新提示均没有新增回归。

### N3-D：来源故障维护与小批量扩展

从已有失败记录选取问题源，按“LatestNews 接口 → 采集出口 → 源站响应 → 解析输出”定位原因。FreeBuf、Hacker News、Bilibili 的历史 403/405 先与当次来源、部署版本和日志对应；不能把旧日志视为当前故障。限流或拒绝访问时保留明确错误、旧缓存和来源状态，优先使用发布方公开接口或订阅源。

验收：每个确认的问题都有稳定回归数据、可读错误与回退方式。只有完成来源筛选、维护说明和质量检查后，才新增一批最多 3 个互补来源；不把扩充数量作为阶段完成条件。

N3 回退：按来源停用、插件版本回退或清空配置型清单并重启服务；保留既有来源 ID、用户关注和已保存文章。

## 7. N4：性能预算与回归

文件入口：`scripts/performance/`、`server/utils/source-fetch.ts`、`server/utils/fetch-scheduler.ts`、`src/hooks/useNewsSource.ts`、`vite.renderer.ts`、`electron/lifecycle.ts`。

1. 在 N1 固定环境下重测当前版本，复用 `performance:baseline`、`performance:web-baseline`、`performance:electron-lifecycle`。Node 覆盖命中、冷缓存、部分命中和旧缓存，每档至少 1,000 个请求；Web 记录真实浏览器请求瀑布；Windows 冷/热启动各至少 5 次，再记录 30 分钟阅读、切页、隐藏与恢复。
2. 记录实际提交、工具版本、硬件、数据量、缓存状态、样本和原始报告。旧的 2026-10-18 数值只用于相同条件比较，不视为当前版本指标。
3. 选取测量中最明显的一项瓶颈，修复后按相同条件复测。路由拆分、轮询和请求合并已有实现，不重复建设。
4. 将确定性指标接入现有 CI：先限制首屏资源体积、请求数量和任务资源上限；共享运行器时延先保存趋势，完成波动评估后再设失败阈值。

验收：至少一项已定位瓶颈有前后数据；没有数据丢失、陈旧状态隐瞒或后台请求增长。性能阈值在新基线后冻结；稳定内存、LCP 和真实交互缺少证据时明确保留缺口。

回退：独立撤回具体优化或预算配置；保留原始报告，不更改来源和持久化格式以改善测量结果。

2026-11-04 API 基线结果：在 Node `22.23.4`、pnpm `12.16.1`、Windows 11 Pro for Workstations、AMD Ryzen 9 5900X、24 逻辑核心、30 个测试来源和每源 30 条数据下，运行 `performance:baseline --samples 1000 --concurrency 30` 通过。报告为 `.data/performance/2026-11-03T21-57-57.617Z-81e84263e08b.json`，8 个场景均为 HTTP 200、错误率 0、状态匹配 0。命中缓存的 30 来源场景 P95 为 40.793 ms；冷缓存的 30 来源场景 P95 为 3,182.127 ms，单来源冷缓存 P95 为 98.578 ms；服务峰值 RSS 为 168,218,624 字节，平均 CPU 为 32.013%。冷批量耗时与 Node 宿主现有四任务并发上限和每次隔离 worker 启动有关；该上限是插件平台的既有资源边界，本次不直接提高，前后优化数据仍待补齐。

2026-11-04 并发对比结果：临时将 Node 插件宿主并发从 4 调到 8 后，使用相同 Node `22.23.4`、pnpm `12.16.1`、30 来源和 1,000 请求基线重新测量。8 个场景均无错误、无状态不匹配，但 30 来源冷缓存 P95 从 3,182.127 ms 增至 4,975.81 ms，增加 56.37%；P99 为 5,476.991 ms，RPS 从 21.10 降至 17.39。峰值 RSS 从 168,218,624 字节降至 151,707,648 字节，但延迟恶化不接受，因此恢复并保留四任务资源边界。对比报告为 `.data/performance/2026-11-03T22-42-15.370Z-0a8bdaec0d50.json`。

2026-11-04 Web 基线结果：原 `performance:web-baseline` 固定读取 Nitro 输出中的 `dist/output/public/index.html`，正式 `pnpm build` 收尾后不会保留该静态入口，命令以 `ENOENT` 失败。已改为复用 `build:web:test` 静态生产构建，并允许通过 `LATESTNEWS_WEB_BASELINE_ROOT` 指定资源根目录。Node `22.23.4` 下重跑通过：`dist/index.html` 为 3,164 字节（gzip 1,165），JavaScript 48 个、880,993 字节（gzip 296,261），CSS 2 个、158,652 字节（gzip 29,127）；最大资源为 `routeTree-CIj5SQin.css`，158,514 字节。受影响的 lint、类型检查和差异检查均通过。

2026-11-04 Web 请求瀑布结果：新增 `performance:web-waterfall`，使用 `build:web:test`、真实 Chromium、静态生产资源和本地 HTTP API 响应，记录浏览器请求时序、HTTP 状态和传输大小。Node `22.23.4`、pnpm `12.16.1` 下运行通过，报告为 `.data/performance/web-waterfall-2026-11-03T22-33-11-237Z.json`。共 45 个请求，失败 0 个，总响应 905,723 字节；资源类型为脚本 36、fetch 4、样式表 2、图片 1、字体 1、文档 1。导航耗时为 788 ms，`/feed` 文档 HTTP 200、3,164 字节；最大资源为 `routeTree-CIj5SQin.css`，158,514 字节。构建显式使用同源 `VITE_API_URL=/`，避免把性能数据发送到外部认证服务。

2026-11-04 Electron 生命周期结果：首次执行因探针在设置隔离用户目录前请求单实例锁，受运行中的旧版 LatestNews 阻塞，未生成报告。已在请求单实例锁前应用 `LATESTNEWS_ELECTRON_LIFECYCLE_USER_DATA`，普通启动路径不变。Node `22.23.4` 下重跑 `performance:electron-lifecycle` 通过：`app://bundle/feed` 加载完成，事件 12 个，关闭前窗口 1 个、关闭后窗口 0 个，进程指标 4 个，渲染器控制台无错误，桌面 API 地址修改和恢复均通过；无残留 Electron 或探针进程。该结果只覆盖一次生命周期探针，不替代计划要求的 5 次冷/热启动和 30 分钟阅读流程。

2026-11-04 重复启动结果：在同一 `out` 产物上使用 Node `22.23.4`、pnpm `12.16.1`，每次创建新的隔离用户目录，连续 5 次冷启动和 5 次暖启动均通过。冷启动耗时范围为 1,346.93–1,411.59 ms，平均 1,368.75 ms；暖启动耗时范围为 1,356.20–1,379.94 ms，平均 1,369.45 ms。每次均观察到 12 个生命周期事件、4 个进程、关闭前 1 个窗口和关闭后 0 个窗口，stderr 为空且无残留进程。暖启动仅表示进程和文件系统缓存已热，不复用用户目录；30 分钟阅读、切页、隐藏和恢复仍待执行。

## 8. N5 与其他条件性任务

| 任务 | 恢复或启动条件 | 交付要求 |
| --- | --- | --- |
| 七天公网质量观察 | 用户恢复该任务，稳定运行环境和目标部署版本已确认 | 每个来源至少 96 条经校验的采样记录且实际跨度至少 7 天；成功和失败均保留，沿用工具当前阈值，按来源类型复核时间完整率与新鲜度 |
| D1 持久缓存 | 有对应测试环境、绑定配置和部署访问条件 | 读写、重启持久化与健康状态分别核验；新闻接口 HTTP 200 不代替缓存验收 |
| macOS/Linux 真实安装 | 有对应系统与架构设备或明确验收人员 | 安装、窗口、外链、升级保留数据与卸载结果；缺少设备就保持待验收 |
| 独立采集插件试点 | N3 通过；至少两个真实适配器需要独立发布，或外部维护者已明确接入需求 | 先做两个适配器、兼容范围、权限执行、健康、升级与回退；根据结果决定是否继续平台化 |
| 节点联邦部署验收 | 有本地 Docker 测试节点和专用测试凭据 | 验证鉴权轮换、scope、限流、熔断、审计接收及本地数据回退；现有接口只包含节点清单与诊断 |
| 跨节点条目读取 | 有明确下游使用者和独立协议评估 | 先定义来源归属、条目读取、去重、缓存隔离和故障回退；不从节点清单功能推断已支持跨节点 Feed |
| 签名、公证 | 有证书和发布资源 | 自动更新已获用户批准；签名、公证和各系统真实安装分别验收，不能从生成安装包推断已支持 |

七天观察继续按用户之前的延期决定执行，本轮不启动采样、监控或部署。恢复前确认 `.data/source-quality/` 中旧 JSONL 的最后记录、采样进程和目标部署提交，另建可区分的运行记录。公网只接受明确目标 HTTPS，间隔至少 15 分钟；673 轮包含 672 次等待，实际跨度至少 7 天。

初始判定由 `shared/source-quality-policy.ts` 定义：每源至少 96 条记录、跨度 7 天、成功率至少 90%、非空率至少 80%、P95 新鲜度不超过 24 小时。保留失败记录；无发布时间的来源标明缺失，不用抓取时间代替。工具提交与远端部署提交分别记录。未满足外部条件时，可继续不依赖该条件的切片。

## 9. 验证与交付规则

以下命令是后续实施的检查入口，不表示本轮已执行。

| 变更范围 | 检查入口 | 必须补充的证据 |
| --- | --- | --- |
| 计划文档 | UTF-8、LF、相对链接、编号与交叉引用、`git diff --check` | 应用测试和 UI 验收不适用 |
| 共享逻辑、API、来源 | `pnpm lint:check`、`pnpm typecheck`、`pnpm test --run`、`pnpm build` | 与改动对应的真实实现测试；Pages 变化追加 `pnpm build:pages` |
| Web/共享 UI | 上述检查及 `pnpm test:e2e:web` | Computer Use 浏览器窗口、桌面与窄屏、键盘与焦点 |
| Electron | `pnpm typecheck:electron`、`pnpm test:electron`、`pnpm electron:build`、`pnpm test:e2e:electron` | 实际打包程序、隔离用户目录、原生窗口行为 |
| 统一爬虫引擎 | `pnpm lint:check`、`pnpm typecheck`、`pnpm test --run`、`pnpm build`；补充三类适配器契约测试 | 传统 getter、插件 provider、配置型来源的输出一致性、取消、超时、健康记录和回退结果 |
| 插件宿主 | `pnpm test:crawler:electron`、`pnpm test:crawler:docker` | 同包摘要、输出一致、故障、资源和清理记录 |
| Docker 或同步服务集成 | 通过 WSL 执行 Docker/Compose，并进行实际客户端连接 | 先核对 WSL 发行版、Docker 状态和端口，再记录服务、镜像版本、启动、连接和清理；Windows 缺少 `docker` 命令不代表服务不可用 |
| 正式发布 | 新标签完整发布 CI、资产与摘要复核 | 标签和版本一致、10 个桌面安装/归档文件与 1 个 Web 包按预期齐全，新增校验和匹配；Docker 标签与摘要另验 |

每个切片完成后记录“范围、验收条件、实际结果、限制、回退边界”。完成检查后按用户授权独立提交、推送或发布。后续若需反复监控 CI，先记录仓库、run ID、head revision 和 job ID，再交给只读监控子代理；完成或失败后停止。

## 10. 下一次开发从哪里开始

### R-A：先修复动态目录启动与状态保留

范围：R1、R2；修改入口为 `src/main.tsx`、运行时来源目录、关注状态初始化和发现列表。保持现有来源 ID、存储键和快照格式，不清空或迁移用户数据。先修复缓存键初始化顺序，再让目录就绪与依赖状态初始化保持一致；等待必须有界，目录失败不能阻止内置来源页面启动。目录后续变化需要刷新发现列表，不能只修改共享对象。

验收：

- 有快照时断网启动，动态来源仍可识别，关注、收藏和历史不被清理。
- 无快照时延迟返回目录，动态来源能够被发现；已保存的动态关注项不会在目录到达前被过滤并回写。
- 目录移除或停用来源时保留来源标识和已保存文章，状态明确显示停用；远端和本地目录一侧失败不误删另一侧记录。
- 覆盖首次启动、刷新、同一用户目录重启和布局同步先于目录返回的顺序；用实际状态实现断言，不在测试中复制业务逻辑。

验证：`pnpm lint:check`、`pnpm typecheck`、`pnpm typecheck:electron`、`pnpm test --run`，再在 Node `22.23.4` 下执行受影响的 Web/Electron 构建与 E2E。通过 Computer Use 检查真实浏览器和桌面窗口中的发现、关注与重启；未取得窗口证据时明确保留该项。

回退：只撤回本切片目录初始化和状态更新代码，保留旧格式读取、用户数据及已保存文章。

### R-B：补齐未采样来源的执行器分类

范围：R3；由已有适配器注册信息生成来源类型，不能为了分类触发一次真实采集。保持 API 字段和筛选参数兼容，旧客户端仍可读取摘要。

验收：服务启动后、没有调用采集前，内置、插件和配置型来源出现在对应类型筛选中；状态仍为 idle。单测和 API 测试覆盖目录、健康摘要与筛选的组合，Web 验证筛选及重置。执行共享逻辑/API 的检查入口；Pages/Node 构建分别检查已有运行环境边界。

回退：撤回分类初始化和对应摘要变更，不删除健康数据或来源目录。

### R-C：恢复桌面坏窗口，再完成 N1-C

范围：R4；只处理主窗口的意外渲染进程退出。先明确可重试次数和失败反馈，避免连续崩溃引发无限重启。正常退出、更新安装、认证窗口关闭不应创建新主窗口。

验收：隔离用户目录中主动终止主 renderer 后，窗口可恢复或提供明确恢复入口；再次启动、托盘恢复、采集模式、窗口可见状态和后台刷新保持一致。补充生命周期测试，运行 Electron 类型检查、单元测试、构建与 E2E；必须取得真实窗口结果。随后完成 N1-C 的原生菜单、图标、安装和卸载，不重复已有 `v0.7.4` 更新下载实验。

回退：只撤回崩溃恢复逻辑，保留现有退出和更新安装流程，不清理用户目录。

### 修复后的顺序与外部条件

1. **N3-B/C**：在 R-A/R-B 通过后，用修复后的提交完成浏览器直连本地 Docker Node 服务的动态来源关注、阅读、收藏、历史和重启。本机 Docker 在 WSL 中运行，先核验发行版、Docker 状态和服务端口；通过 WSL 执行容器测试并记录镜像版本、启动、实际连接与清理。现有 Docker API smoke 和固定测试响应 E2E 不能互相替代。宿主故障测试加入缓存不可写、旧缓存读取和恢复后再写，不改变采集成功的含义。
2. **N2-C**：取得本地 Docker 认证/SyncHub 服务与专用测试配置后，验证两端布局、收藏、历史、失败重试和离线变更。服务条件不足时保持待验收，不以生产请求或 mock 关闭该项。
3. **N1-A/B**：对下一实际交付版本核对 Node `22.23.4` 基线、官方 Vite/pnpm 稳定版与兼容范围，校正 README 的版本及更新说明；单独验证对应 Release 资产摘要和 Docker 版本标签。本轮未升级依赖，不把 2026-11-03 的版本核对当作今天的最新版本结论。
4. **N4**：在修复后的固定构建上补 30 分钟阅读、切页、隐藏恢复数据，并区分旧基线和新结果；没有测量证据时不提高并发上限、不引入缓存服务。

七天公网采样、D1、macOS/Linux 实机、签名和 N5 仍按第 8 节条件处理。本轮不恢复采样、不部署、不发布。上述顺序是后续实施建议，本次授权仅包含审查、更新计划及提交推送计划。

## 11. 维护方式与参考资料

只在本文件更新任务状态、后续顺序、验收结果和未完成项。每个切片记录一条简明结果：日期、提交、执行环境、已完成检查、未执行项和回退条件。已完成任务移出待办表；保留影响后续判断的简短结论，详细变更与旧日志通过 Git 提交历史追溯。

当前记录：2026-11-07 已将 `main` 同步到 `origin/main`，并推送修复提交 `3a63029`、`11f3aa9`。R1/R2 启动目录顺序、R3 idle 执行器分类和 R4 renderer 重载代码已完成；工作区在计划更新前干净。修复后 lint、Node/App/Electron 类型检查、436 项测试、生产构建和 Web E2E 17/19（2 项按条件跳过）通过。未创建新标签或 Release；Node `22.23.4` 精确验证、真实窗口、Docker 组合、SyncHub 和生产状态保持待验收。

历史完成项保留在各阶段：`v0.7.4` 发布资产与 Windows x64 自动更新、N2-A 阅读状态、N2-B 离线快照与 Electron Service Worker 隔离、N3 的本地 Docker API smoke 和固定测试响应的浏览器流程、N4 的 API/启动/请求瀑布基线。R1/R2 的代码路径已修复但真实目录重启证据仍待，R4 真实崩溃注入仍待；N3-A 取消链路仍有限制。N1-C 原生安装、N2-C 真实同步、N3-C Docker 与浏览器组合流程、N4 长时阅读和第 8 节条件性任务保持未完成。

参考资料仅说明现有用法和接口：[安装与使用](README.md#安装与使用)、[部署运维](docs/deployment.md)、[API v1](docs/api-v1.md)、[节点联邦接口](docs/node-federation-contract.md)、[插件开发工具](crawler-platform/README.md)、[贡献指南](CONTRIBUTING.md)、[开源协议](LICENSE.md)。
