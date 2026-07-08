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
| `VITE_APP_TITLE` | No | Build | Browser title and app label. |
| `VITE_API_URL` | No | Build/runtime | Enables login UI only when paired with `JWT_SECRET`. |
| `JWT_SECRET` | Login only | Runtime | Must match the external login service. Do not commit a real value. |
| `ENABLE_CACHE` | No | Runtime | Set to `false` to disable cache reads and writes. |
| `INIT_TABLE` | No | Runtime | Defaults to table initialization; set to `false` after managed schema setup if needed. |
| `LATESTNEWS_NODE_ID` | No | Runtime | Stable node identifier exposed by `/api/v1/node`. |
| `LATESTNEWS_UPSTREAM_ENDPOINT` | No | Runtime | Optional upstream collector hint exposed by `/api/v1/node`. |
| `LATESTNEWS_DOWNSTREAM_ENDPOINT` | No | Runtime | Optional downstream consumer hint exposed by `/api/v1/node`. |
| `PRODUCTHUNT_API_TOKEN` | Source only | Runtime | Required only when enabling the Product Hunt source. |

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
- Set `JWT_SECRET` through an `.env` file or the host secret manager, not in `docker-compose.yml`.
- Set `LATESTNEWS_NODE_ID` when multiple deployments feed the same downstream system.

## Cloudflare Pages

On Cloudflare Pages, use the repository build script:

```bash
pnpm build
```

Use `dist/output/public` as the Pages output directory. For a local Pages rehearsal, run `pnpm preview`; it builds with the Cloudflare preset before starting Wrangler.

If cache and health history should persist, copy [example.wrangler.toml](../example.wrangler.toml), create a D1 database, and keep the binding name aligned with Nitro:

```toml
[[d1_databases]]
binding = "LATESTNEWS_DB"
database_name = "latestnews-db"
database_id = "replace-with-your-d1-id"
```

Recommended Pages settings:

- Build command: `pnpm build`
- Output directory: `dist/output/public`
- Runtime variables: `ENABLE_CACHE`, `INIT_TABLE`, `LATESTNEWS_NODE_ID`, and optional node endpoint hints.
- Secrets: `JWT_SECRET` and source-specific API tokens.

After deployment, verify:

```bash
curl -f https://news.example.com/api/v1/health/deployment
curl -f https://news.example.com/api/v1/health/diagnostics?format=text
curl -f https://news.example.com/api/v1/openapi.json
```

## Node Output

For a custom host, build once and start the Nitro server with a runtime env file:

```bash
pnpm install --frozen-lockfile
pnpm build
node --env-file .env.server dist/output/server/index.mjs
```

The packaged `pnpm start` script runs the same server entry.

## Pre-Release Checklist

- `pnpm check` passes locally.
- `pnpm build` passes when deployment config or build-time variables changed.
- `git diff --check` reports no whitespace errors.
- No committed file contains real secrets, personal tokens, or machine-specific paths.
- `/api/v1/health/deployment` returns `ok` or an expected degraded status with actionable details.
- `/api/v1/node` advertises the expected node ID and public endpoint map.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Login button is missing | Confirm both `VITE_API_URL` and `JWT_SECRET` are configured for the runtime. |
| Cache is always unavailable | Confirm `ENABLE_CACHE` is not `false` and the runtime can write to its data store. |
| D1-backed deploy has no health history | Confirm `LATESTNEWS_DB` is bound and `INIT_TABLE` was not disabled before schema setup. |
| Product Hunt source fails | Confirm `PRODUCTHUNT_API_TOKEN` is set in the runtime secret store. |
| External collector cannot identify this node | Set `LATESTNEWS_NODE_ID` and check `/api/v1/node`. |
