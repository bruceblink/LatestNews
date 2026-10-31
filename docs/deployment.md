# Deployment Operations

LatestNews can run as a Nitro Node service, a Docker container, or a Cloudflare Pages deployment. Keep build-time Vite settings separate from runtime Node settings so the same build can be promoted safely.

## Runtime Modes

| Target | Use when | State location | Health probe |
| --- | --- | --- | --- |
| Docker image | Self-hosted server or NAS | Docker volume mounted at `/usr/app/.data` | `/api/v1/health/deployment` |
| Local Docker build | Release rehearsal or local production check | `newsnow_data` volume | `/api/v1/health/deployment` |
| Cloudflare Pages | Edge-hosted static shell plus Nitro functions | D1 binding `LATESTNEWS_DB` | `/api/v1/health/deployment` |
| Node output | Custom process manager | `.data` under the runtime working directory | `/api/v1/health/deployment` |

## Environment Variables

Start from [example.env.server](../example.env.server) and configure secrets only in the deployment platform or local `.env.server` file.

| Variable | Required | Scope | Notes |
| --- | --- | --- | --- |
| `TZ` | No | Runtime | Defaults to the host timezone when omitted. |
| `VITE_APP_TITLE` | No | Build | Browser, desktop, and PWA name; defaults to `LatestNews`. |
| `VITE_API_URL` | No | Build/runtime | Enables login UI only when paired with `JWT_SECRET`. |
| `VITE_NEWS_API_URL` | No | Web build | Optional HTTPS origin for the remote Node news API. When empty, Web uses the same-origin `/api` path. Electron keeps using its main-process proxy. |
| `LATESTNEWS_WEB_ORIGINS` | No | Node runtime | Comma-separated exact Web origins allowed by the Node API CORS middleware. Leave empty when clients use same-origin requests. |
| `JWT_SECRET` | Login only | Runtime | Must match the external login service. Do not commit a real value. |
| `ENABLE_CACHE` | No | Runtime | Set to `false` to disable cache reads and writes. |
| `INIT_TABLE` | No | Runtime | Defaults to table initialization; set to `false` after managed schema setup if needed. |
| `LATESTNEWS_NODE_ID` | No | Runtime | Stable node identifier exposed by `/api/v1/node`. |
| `LATESTNEWS_UPSTREAM_ENDPOINT` | No | Runtime | Optional upstream collector hint exposed by `/api/v1/node`. |
| `LATESTNEWS_DOWNSTREAM_ENDPOINT` | No | Runtime | Optional downstream consumer hint exposed by `/api/v1/node`. |
| `PRODUCTHUNT_API_TOKEN` | Source only | Runtime | Required only when enabling the Product Hunt source. |
| `LATESTNEWS_CRAWLER_PLUGIN_IDS` | 否 | Node 运行时 | 非空时覆盖本地 `enabled.json` 的启用插件列表。 |
| `LATESTNEWS_CRAWLER_PLUGIN_DIR` | 否 | Node 运行时 | 插件存储目录，默认 `.data/crawler-plugins`。 |
| `LATESTNEWS_CONFIGURED_SOURCE_ALLOWED_HOSTS` | 配置型来源需要 | Node 运行时 | 允许请求的精确 HTTPS 主机名，以逗号分隔。 |
| `LATESTNEWS_CONFIGURED_SOURCES` | 否 | Node 运行时 | 运维维护的版本化 JSON 来源清单；未设置时不启用配置型来源。 |

## 配置型 RSS/JSON 来源

Node 服务可以从运维配置加载 RSS 和受限 JSON 来源。它们通过现有来源目录、详情、单源、批量和 Feed API 提供数据，客户端无需新增来源专属代码。配置默认关闭，变更后重启 Node 服务生效。

Cloudflare Pages 和其他 Edge 部署不运行这套 Node DNS/HTTPS 适配器。Web 可通过 `VITE_NEWS_API_URL` 连接配置该清单的 Node API，同时在 Node 设置精确的 `LATESTNEWS_WEB_ORIGINS`。Electron 连接该 Node API 时通过远端目录读取；本地插件模式不读取这份服务端配置。更多可信插件操作见[插件开发工具](../crawler-platform/README.md)。

先设置主机白名单，再将下面 JSON 作为 `LATESTNEWS_CONFIGURED_SOURCES` 的完整值保存到部署平台或本地运行配置：

```text
LATESTNEWS_CONFIGURED_SOURCE_ALLOWED_HOSTS=feeds.example.com,api.example.com
```

```json
{
  "version": 1,
  "sources": [
    {
      "key": "engineering-blog",
      "name": "工程博客",
      "type": "rss",
      "endpoint": "https://feeds.example.com/engineering.xml",
      "enabled": true,
      "intervalMs": 900000,
      "column": "tech"
    },
    {
      "key": "engineering-api",
      "name": "工程资讯",
      "type": "json",
      "endpoint": "https://api.example.com/news",
      "enabled": true,
      "intervalMs": 900000,
      "column": "tech",
      "mapping": {
        "itemsPath": "data.items",
        "titlePath": "title",
        "urlPath": "url",
        "idPath": "id",
        "publishedAtPath": "publishedAt",
        "mobileUrlPath": "mobileUrl"
      }
    }
  ]
}
```

使用 Compose 时，将变量加入对应服务的 `environment`；仅在宿主 `.env` 中定义变量不会自动传入容器：

```yaml
services:
  latestnews:
    environment:
      LATESTNEWS_CONFIGURED_SOURCE_ALLOWED_HOSTS: ${LATESTNEWS_CONFIGURED_SOURCE_ALLOWED_HOSTS:-}
      LATESTNEWS_CONFIGURED_SOURCES: ${LATESTNEWS_CONFIGURED_SOURCES:-}
```

清单上限为 128 KiB、32 个来源。来源 ID 为 `ext.config.<key>`；`key` 最多 48 个字符，以小写字母或数字开头，后续允许小写字母、数字、下划线和连字符。`intervalMs` 为 30 秒至 24 小时。可选的 `column`、`title`、`description` 和 `home` 用于来源展示。JSON 路径最多八段，只读取对象自有属性，不执行脚本、模板、数组索引表达式或原型属性。

网络和失败行为：

- 只允许精确白名单内的 HTTPS 主机，不接受 IP 字面量、URL 凭据、非默认端口或通配符白名单。
- DNS 的全部 A 记录必须为公网 IPv4；连接固定到已验证地址，保留原主机的 TLS SNI 和 HTTP Host。当前不支持只有 IPv6 地址的来源。
- 最多跟随三次重定向，每次重新检查目标、白名单与 DNS。单次传输超时为 8 秒，调度任务执行上限为 12 秒，每个 origin 最多并发两个任务。
- 不发送用户认证、Cookie 或自定义凭据头。只接受未压缩响应，响应体上限为 2 MiB，每个来源最多处理 30 条，并限制标题、URL、条目 ID 和日期字段长度。
- 清单无效时记录错误并保持配置型来源关闭，静态来源和其他已启用插件仍按原配置运行。将来源的 `enabled` 设为 `false` 后重启，可停用该来源；清空清单后重启可关闭全部配置型来源。

配置清单由运维维护，不应暴露为匿名可写 API。来源发现、配置停用和客户端已保存数据的完整兼容验收，以及生产 CORS 与部署验证，按[主线开发计划](../DEVELOPMENT_PLAN.md)执行；本配置说明不表示这些验收已通过。

## Docker

Use the published image for a normal self-hosted deployment:

```bash
docker compose -f docker-compose.yml up -d
```

Use the local compose file when validating the Dockerfile before release:

```bash
docker compose -f docker-compose.local.yml up --build -d
```

After the container starts, verify the app and public API:

```bash
curl -f http://localhost:4444/
curl -f http://localhost:4444/api/v1/health/deployment
curl -f http://localhost:4444/api/v1/node
curl -f http://localhost:4444/api/v1/openapi.json
```

Operational notes:

- Keep runtime data in the named Docker volume instead of binding the repo directory into the container.
- Alpine builds include Python 3, make and g++ for native SQLite compilation when prebuilt binaries are unavailable. The final image contains libstdc++ and runs a SQLite query during image construction; build tools remain in the builder stage.
- Set `JWT_SECRET` through an `.env` file or the host secret manager, not in `docker-compose.yml`.
- Set `LATESTNEWS_NODE_ID` when multiple deployments feed the same downstream system.

## Cloudflare Pages

For a Cloudflare Pages project, use the Pages-specific repository build script:

```bash
pnpm build:pages
```

Use `dist` as the Pages output directory. The `CF_PAGES=1` build emits the Pages worker at `dist/_worker.js`; the regular `pnpm build` command emits the Node deployment package instead. Deployment is managed by the configured Pages integration; this repository does not include a Wrangler CLI workflow.

If cache and health history should persist, create a D1 database in the Pages project and keep the binding name aligned with Nitro:

```toml
[[d1_databases]]
binding = "LATESTNEWS_DB"
database_name = "latestnews-db"
database_id = "replace-with-your-d1-id"
```

Recommended Pages settings:

- Build command: `pnpm build:pages`
- Output directory: `dist`
- D1 binding: `LATESTNEWS_DB`
- Runtime variables: `ENABLE_CACHE`, `INIT_TABLE`, `LATESTNEWS_NODE_ID`, and optional node endpoint hints.
- Secrets: `JWT_SECRET` and source-specific API tokens.

When Pages must read plugins from a separate Node API, set the Pages build variable `VITE_NEWS_API_URL` to the Node API origin, for example `https://api.example.com`. Set `LATESTNEWS_WEB_ORIGINS` on that Node service to the exact Pages origin, for example `https://news.example.com`. Keep `VITE_API_URL` for login and user synchronization; it does not select the news API.

After deployment, verify:

```bash
curl -f https://news.example.com/api/v1/health/deployment
curl -f https://news.example.com/api/v1/health/diagnostics?format=text
curl -f https://news.example.com/api/v1/openapi.json
```

The Pages build must emit a self-contained dist/_worker.js/index.js. The build command verifies that the worker has no split modules, that the PWA precache excludes _worker.js, and that source modules initialize without process.versions.node. The Pages configuration uses Cheerio's browser entry for HTML parsing so Undici's Node-only initialization is excluded from the worker. When the web shell should use a separate self-hosted edge collector, set VITE_NEWS_API_URL and configure LATESTNEWS_WEB_ORIGINS; do not run long-lived crawler jobs in Pages Functions.

## Node Output

For a custom host, build once and start the Nitro server with a runtime env file:

```bash
pnpm install --frozen-lockfile
pnpm build
node --env-file .env.server dist/output/server/index.mjs
```

The packaged `pnpm start` script runs the same server entry.

The Node build keeps the server entry in one bundle so Nitro can resolve the
public asset directory next to the packaged server output. Deploy the complete
`dist/output` directory, including both `server` and `public`, rather than only
the server entry.

## Pre-Release Checklist

- `pnpm check` passes locally.
- `pnpm build` passes when deployment config or build-time variables changed.
- `git diff --check` reports no whitespace errors.
- No committed file contains real secrets, personal tokens, or machine-specific paths.
- `/api/v1/health/deployment` returns `ok` or an expected degraded status with actionable details.
- `/api/v1/node` advertises the expected node ID and public endpoint map.

If the Pages homepage and OpenAPI return 200 while data routes return 500, rebuild with pnpm build:pages and confirm a single _worker.js/index.js. Then check the Pages compatibility date, nodejs_compat, and D1 binding.

If the runtime log reports Cannot read properties of undefined (reading 'split') inside Undici, check whether the worker contains process.versions.node.split. This indicates that a Node dependency entry was bundled into the worker. Use the Pages configuration that selects Cheerio's browser entry, then rebuild and verify both a real source and an invalid source after deployment. An invalid source must return HTTP 400 rather than HTTP 500. A successful build or deployment alone does not verify the production news API.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Login button is missing | Confirm both `VITE_API_URL` and `JWT_SECRET` are configured for the runtime. |
| Cache is always unavailable | Confirm `ENABLE_CACHE` is not `false` and the runtime can write to its data store. |
| D1-backed deploy has no health history | Confirm `LATESTNEWS_DB` is bound and `INIT_TABLE` was not disabled before schema setup. |
| Product Hunt source fails | Confirm `PRODUCTHUNT_API_TOKEN` is set in the runtime secret store. |
| External collector cannot identify this node | Set `LATESTNEWS_NODE_ID` and check `/api/v1/node`. |
