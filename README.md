# LatestNews

![LatestNews logo](./public/icon.svg)

支持 Web 与桌面端的实时资讯阅读器，聚合你真正关心的新闻源。

[打开 Web 版](https://news.likanug.top) · [下载桌面版](https://github.com/bruceblink/LatestNews/releases/latest) · [安装步骤](#安装与使用) · [反馈问题](https://github.com/bruceblink/LatestNews/issues)

## 项目简介

LatestNews 是一个以中文资讯聚合为核心的实时阅读应用。Web 与 Electron 桌面端共用页面、阅读功能和设置面板，支持自定义布局、统一 Feed、阅读历史、收藏和来源健康诊断。服务端支持 Node、Docker 和 Cloudflare Pages 部署。

当前源码版本为 `0.7.1`，在 `v0.7.0` 基础上迭代。Web 可在网站部署后即时更新；桌面端使用 GitHub Releases 中实际发布的安装包。源码版本号不表示同版本安装包已经发布。

| 使用方式 | 安装要求 | 新闻来源 | 更新方式 |
| --- | --- | --- | --- |
| Web | 浏览器直接打开，无需安装 | 远端新闻服务 | 随网站部署更新 |
| 浏览器应用（Progressive Web App / PWA） | 通过浏览器安装到桌面或主屏幕 | 与当前网站相同 | 随网站更新，收到新版本提示后刷新 |
| Electron 桌面端 | Windows、macOS 或 Linux 安装包 | 远端、本地插件或自动回退 | 下载安装同一架构的新版本 |

## 安装与使用

### Web 与浏览器应用

直接打开 [news.likanug.top](https://news.likanug.top) 即可阅读。页面右上角菜单中的 **安装与下载** 提供桌面下载入口与浏览器安装步骤。浏览器提供原生安装请求时，面板还会显示 **安装浏览器应用** 按钮。

| 设备与浏览器 | 安装步骤 |
| --- | --- |
| 电脑 Chrome | 浏览器菜单 → 投放、保存和分享 → 将网页安装为应用；部分网站也会显示地址栏安装图标 |
| 电脑 Edge | 浏览器菜单 → 应用 → 将此站点作为应用安装 |
| Android Chrome | 浏览器菜单 → 添加到主屏幕或安装应用 → 按提示确认 |
| iPhone / iPad Safari | 分享 → 添加到主屏幕 → 添加；如果显示“作为 Web App 打开”，将其打开 |
| Mac Safari | 支持此功能的版本可从“文件”菜单选择“添加到程序坞” |

浏览器菜单名称可能因版本而异。没有安装入口时，可以直接使用网页，或换用上述浏览器。微信等内置浏览器可先选择“在浏览器中打开”。安装步骤参考 [Chrome 帮助](https://support.google.com/chrome/answer/9658361?hl=zh-Hans)、[Edge 帮助](https://support.microsoft.com/en-us/edge/install-manage-or-uninstall-apps-in-microsoft-edge) 和 [Apple 帮助](https://support.apple.com/zh-cn/guide/iphone/iphea86e5236/ios)。

Web 无需等待桌面 Release 即可部署更新。已打开的网页可能仍在使用旧资源；收到新版本提示时刷新即可。离线模式只能读取已缓存的内容，获取新新闻仍需联网。

### 桌面客户端

1. 打开 [最新已发布版本](https://github.com/bruceblink/LatestNews/releases/latest)，在 **Assets** 中选择对应系统和架构的安装包。也可在 [全部版本](https://github.com/bruceblink/LatestNews/releases) 中查看历史版本和变更记录。
2. 按下表完成安装。使用安装包无需预先安装 Node.js 或 pnpm。
3. 启动 LatestNews。右上角齿轮打开设置，菜单中的 **安装与下载** 可查看后续已发布版本。

以下文件名中的 `<版本>` 以下载页面为准。`x64`、`x86_64` 和 `amd64` 均表示常见的 Intel / AMD 64 位架构；`arm64` 表示 ARM 64 位架构。

| 系统与架构 | 安装包 | 安装方式 |
| --- | --- | --- |
| Windows x64 | `LatestNews-<版本>-Windows-x64.exe` | 运行安装程序，选择安装目录，从桌面或开始菜单启动 |
| Windows ARM64 | `LatestNews-<版本>-Windows-arm64.exe` | 在系统设置的“系统信息”中确认 ARM64 后，运行安装程序 |
| macOS Apple Silicon | `LatestNews-<版本>-macOS-arm64.dmg` | 打开 DMG，将应用拖入“应用程序”后启动 |
| macOS Intel | `LatestNews-<版本>-macOS-x64.dmg` | 在“关于本机”确认 Intel 处理器后，按 DMG 步骤安装 |
| Linux x64 | `LatestNews-<版本>-Linux-x86_64.AppImage` 或 `LatestNews-<版本>-Linux-amd64.deb` | AppImage 需先在文件属性中允许作为程序执行；Debian / Ubuntu 可用软件安装器安装 DEB |
| Linux ARM64 | `LatestNews-<版本>-Linux-arm64.AppImage` 或 `LatestNews-<版本>-Linux-arm64.deb` | 按对应的 AppImage 或 DEB 步骤安装 |

macOS Release 也提供 ZIP 包。桌面包目前没有代码签名，macOS 包没有公证。仅从本仓库的 Releases 获取安装包；如果系统阻止启动，请先核对下载来源和系统提示。

### 桌面首次配置与更新

`0.7.x` 桌面端默认使用自动采集模式，新闻服务为 `https://news.likanug.top`。设置支持三种采集模式：

- **自动**：优先请求远端；网络、超时或服务端错误时，对可用的本地插件来源回退。
- **远端**：使用配置的新闻 API。可填写自建服务根地址。
- **本地**：只使用已安装的本地来源插件。安装包预置 Pcbeta、FreeBuf、掘金和 Hacker News，首次启动会安装缺失包。

本地插件采集仍需联网。采集失败时可以回退到已有的持久新闻缓存；没有缓存的来源无法离线读取。新闻 API 配置不改变认证服务或 SyncHub 地址。

托盘后台刷新默认关闭。启用后，关闭窗口会保留托盘并继续刷新本地来源。完全退出时使用托盘菜单的退出操作。

桌面端当前通过安装包更新：先完全退出应用，再安装同一系统与架构的新版本。PWA 的网页更新不会替换 Electron 安装包。本次桌面版本为 `v0.7.1`，后续版本以它为迭代基线。Web 版本可在网站部署后即时更新，不需要等待桌面安装包发布。具体版本包含的功能以对应 Release 变更记录为准。

安装入口改进记录见 [Web 与桌面安装指引更新](./docs/23-installation-guide-update.md)。

## 当前能力

- 实时拉取并聚合多类中文热点与资讯源
- 自定义首页栏目布局，并支持一键重置
- GitHub 登录后自动同步用户布局配置
- 支持手动同步、同步状态提示和失败重试
- 提供数据源健康页，可查看异常源、错误信息和单源探测结果
- 提供 v1 只读 API、节点清单、JSON Feed/RSS 和诊断导出，便于外部工具接入
- 支持安装为 PWA，并提供离线与更新反馈
- 支持缓存、限频抓取与登录用户强制刷新
- 支持通过 `https://sync.likanug.app` 和 LatestNews API Key 同步阅读历史、收藏与偏好，也可覆盖服务地址接入自建 SyncHub
- Web 与 Electron 共用独立的设置按钮和配置面板；桌面端可以覆盖新闻数据源 API 根地址
- 桌面端支持自动、远端和本地采集模式，预置四个可信来源插件，并保存本地新闻缓存
- 桌面端可选关闭到托盘及后台刷新本地来源

## 技术栈

- 前端：React 18、Vite 8、TanStack Router、TanStack Query、Jotai、UnoCSS
- 服务端：Nitro、H3、better-sqlite3、db0
- 抓取与解析：Cheerio、ofetch、fast-xml-parser
- 工程化：TypeScript、ESLint、Vitest、Commitlint、GitHub Actions

## 源码开发

### 环境要求

- 推荐 Node.js 24；使用 Node.js 22 时需为 22.12 或更高版本，详见 [Vite 环境要求](https://vite.dev/guide/)
- 使用 `package.json` 指定的 pnpm 版本，当前为 `10.30.3`

这些工具仅用于源码开发和构建。在线阅读与桌面安装包不需要这些工具。

### 本地开发

```bash
pnpm install --frozen-lockfile
pnpm dev
```

默认会在启动前执行资源预处理脚本。如果你需要完整的登录和同步能力，请同时配置服务端环境变量。

### Electron 桌面开发

Electron 桌面端复用同一份 React 入口、路由、页面和 service。应用界面从安装包中的本地资源加载。新闻数据默认请求 `https://news.likanug.top`，登录默认请求 `https://api.likanug.top`。默认自动模式可对本地插件支持的来源回退采集。

```bash
pnpm electron:dev
pnpm typecheck:electron
pnpm test:electron
pnpm performance:electron-lifecycle
pnpm electron:package:win
pnpm electron:package:mac
pnpm electron:package:linux
```

桌面构建可通过 `LATESTNEWS_DESKTOP_API_URL`、`LATESTNEWS_DESKTOP_AUTH_API_URL` 和 `LATESTNEWS_DESKTOP_AUTH_CALLBACK_URL` 覆盖新闻 API、认证 API 和登录回调地址。生产构建要求远程地址使用 HTTPS。开发时仅允许把 HTTP 用于本机 API。桌面应用将已验证的 SyncHub 地址和 API Key 一起加密保存；地址不变时可留空复用密钥，更换地址时需要重新输入并验证。

Header 右侧的齿轮按钮在 Web 和 Electron 中打开同一套设置面板。Web 端显示构建变量 `VITE_NEWS_API_URL` 的来源说明；Electron 端可以填写新闻服务根地址，保存后写入应用用户数据目录，并立即用于后续 `/api` 请求。认证服务和 SyncHub 不使用这个数据源地址。

## 环境变量

可参考 [example.env.server](./example.env.server) 进行配置：

```env
TZ=Asia/Shanghai
VITE_APP_TITLE=LatestNews
VITE_API_URL=http://localhost:8000
# Pages frontend build only: set when the web app must read plugins from a separate Node API.
# VITE_NEWS_API_URL=https://api.example.com
# Node runtime: exact web origins allowed to call the news API; separate multiple origins with commas.
LATESTNEWS_WEB_ORIGINS=https://news.example.com
JWT_SECRET=
ENABLE_CACHE=true
INIT_TABLE=true
LATESTNEWS_NODE_ID=
LATESTNEWS_UPSTREAM_ENDPOINT=
LATESTNEWS_DOWNSTREAM_ENDPOINT=
PRODUCTHUNT_API_TOKEN=
```

变量说明：

- `VITE_APP_TITLE`：浏览器与桌面应用名称，未配置时默认为 `LatestNews`
- `VITE_API_URL`：登录与用户同步相关 API 地址
- `VITE_NEWS_API_URL`：可选 Web 构建变量。设置为远程 Node API 根地址后，Web 新闻请求使用该服务；桌面仍使用主进程代理。
- `LATESTNEWS_WEB_ORIGINS`：Node 运行变量。填写允许访问 Node API 的 Web 来源地址；多个地址用逗号分隔。
- `LATESTNEWS_DESKTOP_API_URL`：可选的桌面新闻 API 根地址，默认 `https://news.likanug.top`；桌面设置面板可以在运行时覆盖这个默认值
- `LATESTNEWS_DESKTOP_AUTH_API_URL`：可选的桌面认证 API 根地址，默认 `https://api.likanug.top`
- `LATESTNEWS_DESKTOP_AUTH_CALLBACK_URL`：可选的桌面登录回调地址，默认 `https://news.likanug.top/auth/callback`
- `JWT_SECRET`：与登录服务保持一致的 JWT 密钥
- `ENABLE_CACHE`：是否启用服务端缓存
- `INIT_TABLE`：首次初始化数据库时设置为 `true`
- `LATESTNEWS_NODE_ID`：可选的节点标识，用于 `/api/v1/node`
- `LATESTNEWS_UPSTREAM_ENDPOINT`：可选的上游节点地址，用于节点清单
- `LATESTNEWS_DOWNSTREAM_ENDPOINT`：可选的下游接入地址，用于节点清单

如果未配置 `VITE_API_URL` 和 `JWT_SECRET`，应用仍可运行，但不会显示登录与同步能力。

## API 与外部接入

LatestNews 提供面向自动化工具、订阅器和下游采集节点的只读 v1 API。建议外部系统先请求 `/api/v1/node` 获取节点标识、版本、公开端点、数据源清单和健康摘要；如需机器可读契约，可请求 `/api/v1/openapi.json`。

详细接口、筛选参数和诊断导出说明见 [API v1 文档](./docs/api-v1.md)。

## 部署

更完整的部署路径、环境变量、健康检查和排障说明见 [部署运维文档](./docs/deployment.md)。

### Cloudflare Pages

- 构建命令：`pnpm run build:pages`
- 输出目录：`dist`

如果需要缓存与数据库能力：

1. 创建 D1 数据库
2. 在 Pages 项目的数据库绑定中选择 `LATESTNEWS_DB`
3. 配置数据库名称和 ID
4. 重新触发 Pages 构建

### Docker

项目根目录已提供 Dockerfile 和 Compose 配置：

```bash
docker compose -f docker-compose.yml up -d
```

如需本地联调，可使用 [docker-compose.local.yml](./docker-compose.local.yml)。

## 常用脚本

| 命令 | 说明 |
| --- | --- |
| `pnpm dev` | 本地开发 |
| `pnpm build` | 生产构建 |
| `pnpm brand:assets` | 根据 SVG 生成 favicon、PWA 图标和分享图 |
| `pnpm check` | 执行 lint、typecheck 和 test |
| `pnpm typecheck` | 运行 TypeScript 检查 |
| `pnpm test` | 运行 Vitest |
| `pnpm electron:dev` | 启动 Electron 桌面开发环境 |
| `pnpm electron:build` | 构建桌面主进程、预加载脚本和共享前端 |
| `pnpm electron:package:win` | 生成 Windows NSIS 安装包 |
| `pnpm electron:package:mac` | 生成 macOS DMG 和 ZIP |
| `pnpm electron:package:linux` | 生成 Linux AppImage 和 DEB |
| `pnpm typecheck:electron` | 检查桌面主进程和构建配置 |
| `pnpm test:electron` | 检查桌面 API 转发和资源隔离规则 |
| `pnpm performance:electron-lifecycle` | 构建并探测桌面启动、`/feed` 切页、最小化恢复和窗口关闭 |

## 发布产物

[GitHub Releases](https://github.com/bruceblink/LatestNews/releases) 提供 Windows、macOS 和 Linux 的 x64/ARM64 桌面包，以及 `LatestNews-<版本>-Web.zip` Node 部署包。普通用户使用上方的 [Web 入口或桌面安装步骤](#安装与使用)；自托管使用 [部署运维文档](./docs/deployment.md)。

Docker 镜像发布到 `ghcr.io/bruceblink/latestnews`，支持 `linux/amd64` 和 `linux/arm64`。使用 Compose 时将镜像固定为已发布的版本，例如 `ghcr.io/bruceblink/latestnews:<版本>`。Web 站点部署与桌面安装包独立交付，不必等待所有平台完成打包后才更新网站。

## 项目结构

- [src](./src)：前端页面、组件、状态和 hooks
- [server](./server)：Nitro API、抓取逻辑、数据库与中间件
- [shared](./shared)：前后端共享常量、类型和数据源定义
- [docs](./docs)：开发路线、API、部署和外部接入文档
- [scripts](./scripts)：资源预处理和数据源辅助脚本
- [public](./public)：静态资源、图标和 PWA 相关文件

## 路线方向

当前优先级见 [开发总计划](./DEVELOPMENT_PLAN.md)，后续任务、依赖、指标和验收标准见 [性能、新闻源扩展与插件化计划](./docs/02-performance-sources-platform-plan.md)，当前执行切片见 [后续开发计划](./docs/08-next-development-plan.md)。

近期记录：[采样窗口校验](./docs/09-source-quality-window-plan.md)、[Web 接口运行时修复](./docs/10-web-api-runtime-fix.md)、[桌面本地采集评估](./docs/11-desktop-local-collection-assessment.md)、[Cloudflare Pages Worker 构建修复](./docs/12-cloudflare-pages-worker-fix.md)、[桌面远端到本地采集回退](./docs/13-desktop-remote-local-fallback.md)、[桌面内置插件预置](./docs/16-desktop-builtin-plugin-plan.md)、[桌面菜单与独立包启动修复](./docs/17-desktop-menu-package-fix.md)、[Docker 原生依赖修复](./docs/18-docker-native-dependency-fix.md)、[桌面本地来源详情与采集健康](./docs/19-desktop-local-source-details-health.md)、[Electron 采集模式切换](./docs/20-desktop-collection-modes.md)、[Electron 托盘后台刷新](./docs/21-desktop-tray-background-refresh.md)。

- 先建立可重复的性能基线，优化采集并发、缓存等待、首屏、轮询和内存。
- 建立新闻源开发工具、清单校验与质量报告，分批接入高质量源，再支持 RSS/JSON 配置型接入。
- 有独立发布需求后试点采集插件；第三方 UI 与插件市场暂不排期。
- Web 与 Electron 继续共用前端；交付与未关闭验收项见 [多平台计划](./docs/01-web-electron-plan.md)。
- [历史执行路线](./docs/development-roadmap.md) 保留原任务背景；登录同步、离线和真实安装验收继续跟踪。

## 致谢

项目最初参考了 [ourongxing/newsnow](https://github.com/ourongxing/newsnow) 的思路，并在此基础上按当前维护方向继续演进。

## 贡献

欢迎通过 issue 或 pull request 参与改进。提交前请先阅读 [CONTRIBUTING.md](./CONTRIBUTING.md)，并遵循当前仓库的 Conventional Commits 规范。

## License

[GNU Affero General Public License v3.0](./LICENSE)
