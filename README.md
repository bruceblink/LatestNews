# LatestNews

![LatestNews logo](./public/icon.svg)

更干净地阅读实时热点，聚合你真正关心的新闻源。

[在线体验](https://news.likanug.top) · [贡献指南](./CONTRIBUTING.md) · [反馈问题](https://github.com/bruceblink/LatestNews/issues)

## 项目简介

LatestNews 是一个以中文资讯聚合为核心的实时阅读应用，提供更轻量的页面结构、更明确的个性化布局，以及适合长期维护的数据源治理能力。项目基于 React、Vite 和 Nitro 构建，前后端同仓，支持 Web/PWA、Docker 部署和复用同一前端的 Electron 桌面应用。

当前版本重点关注以下方向：

- 实时热点与高频新闻源的稳定聚合
- 基于 GitHub 登录的布局同步
- 面向移动端的 PWA 使用体验
- 数据源健康监控与抓取质量治理

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

## 技术栈

- 前端：React 18、Vite 7、TanStack Router、TanStack Query、Jotai、UnoCSS
- 服务端：Nitro、H3、better-sqlite3、db0
- 抓取与解析：Cheerio、ofetch、fast-xml-parser
- 工程化：TypeScript、ESLint、Vitest、Commitlint、GitHub Actions

## 快速开始

### 环境要求

- Node.js 22+
- pnpm 10+

### 本地开发

```bash
pnpm install
pnpm dev
```

默认会在启动前执行资源预处理脚本。如果你需要完整的登录和同步能力，请同时配置服务端环境变量。

### Electron 桌面开发

Electron 桌面端复用同一份 `index.html`、React 入口、路由、页面和 service。应用界面从安装包中的本地资源加载。新闻数据默认请求 `https://news.likanug.top`，登录默认请求 `https://api.likanug.top`。

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

## 0.6.0 发布产物

[GitHub Releases](https://github.com/bruceblink/LatestNews/releases) 提供 Windows x64/ARM64、macOS Intel/Apple Silicon 和 Linux x64/ARM64 桌面包，也提供 Web Node 部署包。桌面安装包目前没有代码签名；macOS 包也没有公证。

Docker 镜像发布到 `ghcr.io/bruceblink/latestnews`，支持 `linux/amd64` 和 `linux/arm64`。使用 Compose 时可将镜像版本固定为 `ghcr.io/bruceblink/latestnews:0.6.0`。

## 项目结构

- [src](./src)：前端页面、组件、状态和 hooks
- [server](./server)：Nitro API、抓取逻辑、数据库与中间件
- [shared](./shared)：前后端共享常量、类型和数据源定义
- [docs](./docs)：开发路线、API、部署和外部接入文档
- [scripts](./scripts)：资源预处理和数据源辅助脚本
- [public](./public)：静态资源、图标和 PWA 相关文件

## 路线方向

当前优先级见 [开发总计划](./DEVELOPMENT_PLAN.md)，后续任务、依赖、指标和验收标准见 [性能、新闻源扩展与插件化计划](./docs/02-performance-sources-platform-plan.md)，当前执行切片见 [后续开发计划](./docs/08-next-development-plan.md)。

近期记录：[采样窗口校验](./docs/09-source-quality-window-plan.md)、[Web 接口运行时修复](./docs/10-web-api-runtime-fix.md)、[桌面本地采集评估](./docs/11-desktop-local-collection-assessment.md)。

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
