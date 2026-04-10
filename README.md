# LatestNews

![LatestNews logo](./public/icon.svg)

更干净地阅读实时热点，聚合你真正关心的新闻源。

[在线体验](https://news.likanug.top) · [贡献指南](./CONTRIBUTING.md) · [反馈问题](https://github.com/bruceblink/LatestNews/issues)

## 项目简介

LatestNews 是一个以中文资讯聚合为核心的实时阅读应用，提供更轻量的页面结构、更明确的个性化布局，以及适合长期维护的数据源治理能力。项目基于 React、Vite 和 Nitro 构建，前后端同仓，既可以部署为 Web/PWA，也支持 Docker 部署。

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
- 支持安装为 PWA，并提供离线与更新反馈
- 支持缓存、限频抓取与登录用户强制刷新

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

## 环境变量

可参考 [example.env.server](./example.env.server) 进行配置：

```env
TZ=Asia/Shanghai
VITE_APP_TITLE=LatestNews
VITE_API_URL=http://localhost:8000
JWT_SECRET=
ENABLE_CACHE=true
INIT_TABLE=true
PRODUCTHUNT_API_TOKEN=
```

变量说明：

- `VITE_APP_TITLE`：浏览器标题和页面展示名称
- `VITE_API_URL`：登录与用户同步相关 API 地址
- `JWT_SECRET`：与登录服务保持一致的 JWT 密钥
- `ENABLE_CACHE`：是否启用服务端缓存
- `INIT_TABLE`：首次初始化数据库时设置为 `true`

如果未配置 `VITE_API_URL` 和 `JWT_SECRET`，应用仍可运行，但不会显示登录与同步能力。

## 部署

### Cloudflare Pages

- 构建命令：`pnpm run build`
- 输出目录：`dist/output/public`

如果需要缓存与数据库能力：

1. 创建 D1 数据库
2. 复制并修改 [example.wrangler.toml](./example.wrangler.toml)
3. 配置 `database_id` 与 `database_name`
4. 重新部署

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
| `pnpm preview` | 本地预览 Pages 构建结果 |
| `pnpm check` | 执行 lint、typecheck 和 test |
| `pnpm typecheck` | 运行 TypeScript 检查 |
| `pnpm test` | 运行 Vitest |
| `pnpm deploy` | 部署到 Cloudflare Pages |

## 项目结构

- [src](./src)：前端页面、组件、状态和 hooks
- [server](./server)：Nitro API、抓取逻辑、数据库与中间件
- [shared](./shared)：前后端共享常量、类型和数据源定义
- [scripts](./scripts)：资源预处理和数据源辅助脚本
- [public](./public)：静态资源、图标和 PWA 相关文件

## 路线方向

- 继续提升同步状态和多端体验
- 持续完善数据源健康治理和排障效率
- 优化移动端阅读、离线缓存和安装体验
- 逐步扩展高质量数据源与分类能力

## 致谢

项目最初参考了 [ourongxing/newsnow](https://github.com/ourongxing/newsnow) 的思路，并在此基础上按当前维护方向继续演进。

## 贡献

欢迎通过 issue 或 pull request 参与改进。提交前请先阅读 [CONTRIBUTING.md](./CONTRIBUTING.md)，并遵循当前仓库的 Conventional Commits 规范。

## License

[MIT](./LICENSE)
