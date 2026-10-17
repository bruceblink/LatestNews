# Web 与 Electron 共用前端开发计划

日期：2026-10-17。状态：D1、D2 已实现；D3 真实认证服务仍未通过验证；D4 首轮发布 CI 未通过，修复已推送到 `main`，尚未重新触发；D5 已完成部分 Windows 真实窗口和覆盖安装检查。

## 1. 目标与范围

采用“桌面客户端＋远程 API”。Web 和 Electron 共用现有 React 界面及业务代码。日常功能以 Web 前端为主开发，同一次源码变更直接进入两种构建，桌面层保持最小范围。

桌面目标为 Windows、macOS 和 Linux。参考 `F:/project/it-tools-template` 的双端构建、本地资源协议、进程隔离和打包结构，继续使用本项目的 React、TanStack Router、TanStack Query、Jotai 和 UnoCSS。

本阶段交付：

- 相同 HTML 模板、React 入口、路由、页面、组件、主题、状态和 service 层。
- 随安装包分发的前端资源，界面在本机渲染。
- 对现有远程新闻 API、认证服务和 SyncHub 的集中适配。
- Windows、macOS 和 Linux 桌面开发、构建、安装包和持续集成（Continuous Integration / CI）流程。
- Web 构建包、Docker 镜像和桌面安装包的版本化发布。
- Web 回归、桌面自动化和 Windows 真实窗口验收记录。

本阶段不包含本机 Nitro 服务、新闻采集、业务数据库、局域网服务、托盘、开机启动、多窗口、自动更新、代码签名和 macOS 公证。

共用源码可以减少重复开发。Web 上线后，已安装的桌面包仍使用随包分发的页面版本，需要重新构建并安装新版本。首版采用安装包升级，不将 Web 的 Service Worker 更新当作桌面软件更新。

## 2. 术语与当前基线

| 名称 | 责任与边界 |
| --- | --- |
| 渲染进程（Renderer） | 运行共享 React 页面和业务状态，不直接访问 Node 或操作系统。 |
| 主进程（Main Process） | 管理窗口、本地资源、受限远程请求和应用生命周期，不运行新闻业务服务。 |
| 预加载脚本（Preload） | 仅在确有需要时提供少量有固定参数和返回值的平台接口。 |
| 远程新闻服务 | 已部署的 Nitro API，负责采集、缓存、健康状态和洞察计算。 |
| 认证服务 | 现有 `VITE_API_URL` 指向的外部登录和布局同步服务。 |
| SyncHub | 现有历史、收藏和偏好同步服务，地址及 API Key 与新闻服务和认证服务分别管理。 |

实施前源码基线：

- [Vite 配置](../vite.config.ts) 将 React、路由、样式、PWA 和 Nitro 构建放在一起，需要抽取共用的前端配置。
- [React 入口](../src/main.tsx) 和 [页面目录](../src/routes) 可以由两种构建直接使用，不需要桌面页面副本。
- [请求配置](../src/utils/index.ts) 的新闻地址固定为 `/api`，认证地址来自 `VITE_API_URL`，不能把二者当作同一个服务地址。
- [PWA hook](../src/hooks/usePWA.ts) 同时承担网络状态、离线反馈和 Service Worker 更新，需要隔离平台启动与更新动作。
- [登录逻辑](../src/hooks/useLogin.ts)、[用户状态](../src/auth/authAtoms.ts) 和 [布局同步](../src/services/metadata.service.ts) 同时涉及浏览器跳转、Cookie 和 Bearer Token。桌面登录的可用性需要先验证。
- [阅读状态服务](../src/services/offline-reading-state.service.ts)、[Feed 快照服务](../src/services/offline-feed-snapshot.service.ts) 和 [SyncHub 服务](../src/services/synchub.service.ts) 已存在，保留其数据模型、合并策略和失败处理。
- 实施前的发布流程生成 Release 说明，尚未生成 Electron 安装包。

参考项目已检查的文件包括 `electron.vite.config.ts`、`electron/main.ts`、`electron/security.ts`、`electron/preload.ts`、`electron-renderer/main.ts` 和 `.github/workflows/electron-desktop.yml`。只借用与本项目目标有关的结构，不复制 Vue 应用、媒体权限或打印窗口等专用功能。

## 3. 共用代码与平台边界

| 模块 | 共用内容 | 平台差异的集中位置 |
| --- | --- | --- |
| 页面与路由 | `src/routes`、`src/components`、TanStack 路由定义 | 本地资源处理器负责桌面深层路由回退。 |
| 数据与状态 | `shared` 中浏览器可用的模型、`src/atoms`、阅读与同步策略 | 敏感凭据存储通过统一接口处理。 |
| API 调用 | 现有 `src/services`、请求参数、响应类型和错误语义 | 请求适配层处理服务地址、远程转发和必要的平台认证差异。 |
| 前端构建 | React、UnoCSS、别名、路由插件、资源和分包配置 | Web 增加 Nitro/PWA；桌面增加 Electron 主进程和预加载构建。 |
| 启动与更新 | React 挂载、网络状态、离线数据和提示组件 | Web 注册 Service Worker；桌面使用安装包资源，不注册 Service Worker。 |
| 外链 | 共用链接和用户操作 | 桌面主进程校验 URL 后交给系统浏览器。 |

优先复用同一份 `index.html` 和 `src/main.tsx`。如桌面需要移除统计脚本或调整模板标签，通过构建转换完成，避免维护第二份 HTML。平台判断不得散布到每个页面。只抽取双端实际需要的接口，不先建设通用平台框架。

拟新增的文件范围：

| 文件或目录 | 预期用途 |
| --- | --- |
| `vite.renderer.ts` | 两种构建共同使用的前端配置工厂。 |
| `electron.vite.config.ts` | Electron 构建入口。 |
| `electron/main.ts`、`electron/security.ts` | 窗口、本地资源和远程请求边界。 |
| `electron/preload.ts` | 有需要时提供有限的平台接口。 |
| `src/platform/*` | PWA、认证和请求的少量平台适配。 |
| `tsconfig.electron.json` | 桌面代码类型检查。 |
| `.github/workflows/release.yml` | 版本检查、全平台桌面包、Web 部署包、Docker 镜像和 GitHub Release。 |

这些名称是实施起点，可以按实际复杂度合并文件。`server` 中的采集、数据库及其专用依赖不得进入桌面运行包。

## 4. 远程 API、认证与本地数据

### 4.1 新闻请求

桌面通过标准、安全的 `app://bundle/` 协议读取前端资源。协议处理器区分静态资源和允许的 API 路径：页面路径返回本地资源，新闻 `/api/*` 请求转发到构建时配置的远程新闻服务。保留现有 service 调用方式，减少页面改动。

拟新增构建变量 `LATESTNEWS_DESKTOP_API_URL`，默认使用项目现有公开新闻站点的服务根地址。它是公开地址，不是凭据。自建服务通过构建配置覆盖，首版不新增连接管理页面。`VITE_API_URL` 保持原有认证服务含义，SyncHub 保持现有配置入口。

转发必须满足：

- 服务 origin 来自受信任构建配置，页面参数不能改变新闻或认证转发目标。
- 限制 API 路径、方法、请求体和响应大小；保留必要请求头、查询参数、状态码和错误响应。
- 沿用现有请求超时；取消请求应中止上游请求。禁止无限重试。
- 禁止携带凭据的请求自动跳转到其他 origin；不同服务之间不混发 Cookie 或 Token。
- 生产服务使用 HTTPS。HTTP 只用于明确的本地开发配置，不通过关闭 `webSecurity` 绕过限制。
- 接口返回错误时继续显示共用错误状态，不将失败伪装成空新闻。

协议处理器只是客户端网络适配，不创建 HTTP 监听端口或本机业务 API。

### 4.2 认证与同步

认证适配必须在打包收尾前完成可行性验证。首先核对现有认证服务支持的回调地址、Cookie 属性、Token 发放方式和退出行为。

优先采用系统浏览器登录，通过服务支持的桌面回调和一次性授权结果建立桌面会话。浏览器 Cookie 不会自动进入 Electron，不能仅打开浏览器后就认为桌面登录完成。若认证服务缺少桌面回调或授权结果交换能力，记录所需的最小服务端变更及独立范围，再确定实现路径；不预先承诺仅改客户端即可完成。

认证跳转和回调处理集中在平台层，继续复用现有用户状态、布局下载、合并、上传和反馈逻辑。覆盖回调取消、超时、重复回调、会话失效和退出后的缓存清理。缺少测试账号或服务支持时，认证验收保持未完成，不能通过隐藏入口把完整同步标记为完成。

SyncHub 优先复用现有请求与合并逻辑。若桌面来源受到跨域限制，只增加限定 LatestNews 集合、方法和请求头的适配接口，不暴露任意网络代理。API Key 仅发往用户已配置的 SyncHub。桌面凭据持久化使用平台存储接口，并验证系统加密存储的实际可用性。

### 4.3 本地数据与离线行为

- 保留现有历史、收藏、关注源和 Feed 快照格式，以及数量、过期和损坏数据处理规则。
- Web 与桌面分别保存本地数据；通过现有 SyncHub 同步，不直接读取浏览器用户目录。
- 桌面资源随包提供，断网后仍能启动界面。已有快照可以继续阅读，最新新闻仍需要远程 API。
- 现有快照主要覆盖新闻元数据和阅读状态，首版不增加原文全文离线下载。
- 安装升级保留桌面用户数据，不清空历史、收藏和同步配置。

## 5. 分阶段实施

| 顺序 | 切片与依赖 | 主要工作 | 验收条件 |
| --- | --- | --- | --- |
| D1 | 共用前端构建；起点 | 抽取共用配置，增加最小桌面入口、本地资源协议和 PWA 适配；核对认证服务能力。 | 同一份页面源码进入 Web 和桌面产物；Web 构建行为保持兼容；桌面无 Service Worker；认证路径和外部依赖已记录。 |
| D2 | 远程 API；依赖 D1 | 增加固定目标转发和构建配置，复用全部新闻 service、错误状态及离线逻辑。 | 首页、Feed、洞察、健康和源详情读取远程数据；查询、POST、错误、超时和取消正常；桌面无采集器、数据库或监听端口。 |
| D3 | 登录与同步；依赖 D2 及认证服务支持 | 完成集中认证适配、凭据存储和 SyncHub 请求适配，复用状态合并与反馈。 | 登录、取消、退出、过期、布局同步和阅读数据同步可验收；初始化或网络失败不覆盖已有本地数据。 |
| D4 | 多平台打包与发布 CI；依赖 D2，D3 为完整功能交付条件 | 构建 Windows、macOS、Linux 桌面包；打包 Web Node 服务与静态资源；构建并推送多架构 Docker 镜像；生成双语 Release 说明。 | Windows x64/ARM64、macOS x64/ARM64、Linux x64/ARM64 均生成桌面包；Web zip 和 GHCR 镜像成功；任何必需构建失败时不发布 GitHub Release。 |
| D5 | 双端回归与发行演练；依赖 D1 至 D4 | 检查真实窗口、Windows 覆盖安装保留数据、卸载及失败恢复，汇总证据。 | 自动化检查和 Windows 真实窗口验收通过；真实认证服务限制明确；各平台 CI 产物可下载；未完成项列出。 |

每个切片先达到自身验收条件，再扩大范围。D1 至 D4 可生成内部验证产物；完整桌面功能交付必须包含 D3 和 D5。新增桌面专属功能不得混入这些切片。

## 6. 开发、构建与发布约定

保留现有 Web 命令，并提供以下桌面命令：

| 命令 | 预期用途 |
| --- | --- |
| `pnpm electron:dev` | 运行桌面壳和共享前端开发服务，连接配置的远程 API。 |
| `pnpm electron:build` | 构建主进程、预加载脚本和共享前端资源。 |
| `pnpm typecheck:electron` | 检查桌面代码和配置。 |
| `pnpm electron:package:win` | 生成 Windows 安装包，不自动发布。 |
| `pnpm electron:package:mac` | 生成 macOS DMG 和 ZIP，不自动发布。 |
| `pnpm electron:package:linux` | 生成 Linux AppImage 和 DEB，不自动发布。 |
| `pnpm test:electron` | 运行桌面协议、隔离和基础交互检查。 |

使用 `electron-vite` 和 `electron-builder`，在 D1 选择经当前元数据确认兼容的版本，并写入锁文件。构建共用资源预处理和前端插件，不复制路由、组件或来源清单。

CI 在发布标签上并行构建 Windows x64/ARM64、macOS x64/ARM64、Linux x64/ARM64 桌面包、Web Node 部署包和 `linux/amd64`、`linux/arm64` Docker 镜像。所有任务成功后才创建 GitHub Release，并附带桌面包和 Web zip。Release 说明按上一个版本标签到当前标签的提交范围生成。桌面版本与 Web、Docker 版本一致。

桌面包使用最小运行依赖清单，避免根目录服务端依赖被打包器自动全部收集。D4 检查最终包内容。0.6.0 安装包未配置代码签名和 macOS 公证；自动更新作为后续切片，不以生成安装包代替这些能力。

## 7. 验证与完成标准

### 7.1 自动化检查

涉及源码或配置的最终内容至少执行：

```bash
pnpm lint:check
pnpm typecheck
pnpm test --run
pnpm typecheck:electron
pnpm build
pnpm electron:build
pnpm test:electron
pnpm electron:package:win
git diff --check
```

这些命令已随桌面实现加入。最终交付前应在最终源码上运行全部检查；运行结果记录在第 8.1 节。

新增有实际风险价值的测试：本地资源越界与缺失路径、深层路由、远程目标与凭据隔离、方法/参数/错误保留、超时与取消、认证回调、同步失败及升级数据保留。避免为纯配置搬运添加重复测试。

自动化外部服务集成只使用本地 Docker，记录服务、镜像版本、端口、启动与清理结果。不能在 Docker 中提供的认证或 SyncHub 依赖明确列为未完成；桩服务只证明请求适配和错误处理，不代表真实集成通过。生产站点的只读访问只作为部署抽查证据，不替代集成验收。

### 7.2 双端功能矩阵

| 场景 | Web/PWA | Windows、macOS、Linux Electron |
| --- | --- | --- |
| 首页、Feed、洞察、健康、源详情与历史 | 浏览器真实页面检查 | Computer Use 真实窗口检查。 |
| 深层路由、刷新与静态资源缺失 | 验证服务端回退与错误状态 | 验证本地协议回退，缺失资源返回错误。 |
| 筛选、排序、主题、布局、收藏和稍后读 | 共用交互回归 | 相同交互与重启后持久化。 |
| API 不可用、超时、空数据和部分失败 | 现有错误语义保持兼容 | 同一提示与重试行为，不依赖本机服务。 |
| 离线启动和恢复网络 | 验证已注册 Service Worker 与快照 | 验证安装包资源、快照与恢复请求。 |
| 登录、退出、布局与 SyncHub 同步 | 检查现有流程 | 检查桌面会话、取消、过期与失败恢复。 |
| 原文外链与剪贴板 | 检查浏览器行为 | 外链打开系统浏览器；检查焦点和剪贴板。 |
| 页面功能变更复用 | 修改一处共享源码并构建 | 同一变更自动进入桌面，无页面副本或额外业务实现。 |
| 安装、升级与卸载 | 不适用 | CI 生成三类操作系统包；Windows 执行新目录安装、覆盖升级保留数据及卸载检查；macOS/Linux 安装行为需在各系统实机补充验收。 |

Electron 保持 `nodeIntegration: false`、`contextIsolation: true`、`sandbox: true` 和 `webSecurity: true`。静态路径限制在构建目录内，IPC 校验发送方和参数，外链校验协议，内容安全策略（Content Security Policy / CSP）与服务地址保持一致。

真实窗口优先使用 Computer Use。若工具不可用，先进行有界恢复和启动检查，再使用无头验证，并明确记录未覆盖的原生交互。不得将截图、构建成功或无头测试写成真实窗口验收。

## 8. 风险、回退与当前状态

| 风险 | 处理方式 |
| --- | --- |
| 认证服务不支持桌面会话建立 | D1 先核对，D3 单独验证；记录最小外部变更，不在打包后才发现。 |
| 新闻、认证与 SyncHub 的跨源及凭据行为不同 | 分开配置目标，集中适配并测试，不统一为一个通用网络代理。 |
| Web 与已安装桌面版本不同步 | 同一提交生成产物；保持 API 向后兼容；记录桌面支持的服务版本。 |
| 桌面构建带入服务端依赖 | 使用最小运行依赖清单，并检查最终安装包。 |
| 原有部署配置仍在修改中 | 实施前重新检查差异和输出路径；保留已有改动，避免将部署调整混入桌面切片。 |
| Electron 增加包体和内存 | D5 实测并记录，不预设不可靠的复用比例或性能收益。 |

回退以切片为边界：移除该切片新增的 Electron 文件、脚本和依赖，恢复相关共用配置与少量平台适配调用。回退前检查用户新改动，不使用破坏性的 Git 命令。保留原有 Web/PWA 行为、用户数据和远程服务。

实施前已有 `.gitignore`、`package.json`、`pnpm-lock.yaml` 和 `wrangler.jsonc` 改动。处理本次工作区时保留这些用户改动。用户已要求发布 0.6.0，因此本次工作会在验证后提交、推送并发布；不覆盖生产 Web 服务配置。

### 8.1 实施状态与验收记录

| 切片 | 状态与证据 |
| --- | --- |
| D1 共用前端构建 | 已实现。Web 与 Electron 使用共用的 React 入口、路由、页面和 renderer 配置。桌面构建不注册 Service Worker，并从 `app://bundle/` 加载本地页面。 |
| D2 新闻 API | 已实现客户端受限转发、路径和大小限制，并保留共用 service。API 代理与资源安全测试通过。生产站点和部署健康接口可访问；健康结果为 `degraded`，原因是缓存不可用，因此不代表完整生产服务健康。 |
| D3 登录与 SyncHub | 桌面适配和凭据加密代码已实现，但真实服务验收未完成。2026-10-17 只读探测中，`https://api.likanug.top/api/me` 和 `/api/sync/me` 均返回 HTTP 520，无法验证完整登录、布局同步和 SyncHub 会话流程。 |
| D4 多平台打包 | 首轮 CI `39018805479` 的源码检查和 Web 包通过；六个平台包均失败，原因包括 Electron 运行时路径、Windows 原生依赖和 ARM64 `workerd`。`6617fb9` 修复 Electron 下载与桌面依赖安装后，第二轮 CI `39021350553` 的 Windows x64/ARM64、macOS Intel/Apple Silicon、Web 包和 Docker 镜像均成功；Linux x64/ARM64 在构建 `.deb` 时因生成的桌面 `package.json` 缺少 `homepage` 失败，发布任务因此跳过。当前 `scripts/prepare-electron-package.mjs` 已将根清单的 `homepage` 写入桌面清单。本地 `electron:build` 已确认生成 `https://news.likanug.top`；Windows x64 解包包验证成功。修复后的发布 CI 尚待重新运行，0.6.0 尚未发布。 |
| D5 双端验收 | Computer Use 实际打开最新本地 0.6.0 Windows 解包包：热门页显示新闻，Electron 默认菜单已移除，窗口标题栏显示 LatestNews 图标。包内 `resources/icon.png` 存在，`LatestNews.exe` 含 32×32 应用图标。原 `release/win-unpacked` 本地包早于当前源文件构建；更新后的 Windows 安装包仍需发布后再检查任务栏图标。此前将 0.5.2 安装到隔离目录后覆盖安装 0.5.3，测试数据哨兵文件保留；卸载程序返回 0，安装文件和快捷方式均已移除。Windows 登录和同步尚未通过真实服务验证；macOS、Linux 真实窗口及安装升级流程尚未执行。 |

最终源码自动检查结果：`pnpm lint:check`、`pnpm typecheck`、`pnpm typecheck:electron`、`pnpm test --run` 和 `pnpm electron:build` 通过；测试为 55 个文件、255 个用例。`pnpm test:electron` 另行通过，包含 4 个文件、18 个用例。Windows x64 解包包含 `resources/icon.png`，并且其可执行文件图标可读取。`git diff --check` 通过。

开发模式验证中，首页、`/api/v1/health/deployment`、`/api/v1/node` 和 `/api/v1/openapi.json` 返回 HTTP 200。运行 `pnpm electron:build` 更新 `out/` 时，开发服务器没有因生成目录变化而触发 Nitro 解析错误或页面重载循环。资源预处理有 4 个图标下载超时，构建继续使用现有图标；这不影响构建通过，但图标更新未验证。

Windows 安装包的首个 electron-builder 调用遇到 GitHub 下载超时和 Windows 目录替换错误。首次重试生成的包从仓库根目录收集了服务端依赖。项目打包命令现把 `out/` 作为独立项目目录，使用本机 Electron 44.8.0 运行时，并跳过应用依赖重建。最终安装包重新生成成功。检查确认包内没有服务端依赖，全部本地 renderer 资源存在。旧构建留下的 `latest.yml` 与当前安装包不一致，已从输出目录移除。0.6.0 还未发布；应以 GitHub Actions 的全平台产物、Web 包和 GHCR 镜像结果作为发行验收依据。
