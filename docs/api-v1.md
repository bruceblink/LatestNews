# LatestNews API v1

LatestNews exposes APIs for feed readers, diagnostics, downstream collectors, and scheduled source refresh. All paths below are relative to the deployed site root and use the `/api` prefix at runtime.

## Response Shape

Most v1 endpoints return a stable envelope:

```json
{
  "data": {},
  "meta": {
    "generatedAt": 1783512000000
  },
  "errors": []
}
```

- `data`: endpoint-specific payload.
- `meta`: request or generation metadata.
- `errors`: non-fatal errors, especially for partial source responses.

## Node Discovery

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/node` | Node identity, version, endpoint map, source catalog, and health counters. |
| `GET` | `/api/v1/openapi.json` | Machine-readable OpenAPI 3.1 contract for public v1 endpoints. |
| `GET` | `/api/v1/health/deployment` | Deployment readiness across app, cache, and source-health state. |

`/api/v1/node` is the preferred first call for external systems. It includes the current endpoint map, source and column lists, health summary, and optional connection hints. Use `/api/v1/openapi.json` when an integration needs a machine-readable contract.

Optional environment variables:

| Variable | Purpose |
| --- | --- |
| `LATESTNEWS_NODE_ID` | Stable node identifier exposed by `/api/v1/node`. Defaults to the app name when empty. |
| `LATESTNEWS_UPSTREAM_ENDPOINT` | Optional upstream collector endpoint advertised in the node manifest. |
| `LATESTNEWS_DOWNSTREAM_ENDPOINT` | Optional downstream consumer endpoint advertised in the node manifest. |

Example:

```bash
curl https://news.example.com/api/v1/node
```

## Sources

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/sources` | Source and column metadata without item payloads. |
| `GET` | `/api/v1/sources/{id}` | Metadata for one source, including canonical redirect information. |
| `GET` | `/api/v1/sources/{id}/items` | Items for a single source. |
| `POST` | `/api/v1/sources/batch` | Items for multiple sources, columns, or source types. |
| `POST` | `/api/v1/sources/refresh` | 分批刷新来源。默认只刷新到期缓存，`force=true` 采集全部可用来源。 |
| `POST` | `/api/v1/insights` | 计算所选来源的阅读洞察。请求体包含 `sources`，可设置 `trendWindow` 等分析选项。 |

洞察响应的 `data.topicEvents[]` 同时返回旧 `id` 和稳定 `eventId`。旧客户端继续读取 `id`。需要保存或关联事件的客户端使用 `eventId`。新增较晚报道不会改变同一事件的 `eventId`。

Single-source metadata keeps item payloads out of discovery responses. If `{id}` is a redirect alias, `meta.canonicalSourceId` points to the source used by item endpoints and `meta.redirected` is `true`.

从 `GET /api/v1/sources` 的 `data.sources[].id` 读取来源 ID。目录默认包含停用来源，省略重定向别名。应用版本可从 `/api/v1/node` 的 `data.node.version` 读取。

Single-source query parameters:

| Parameter | Purpose |
| --- | --- |
| `since` | Only return items at or after this timestamp. |
| `limit` | Limit item count. |
| `latest` | Prefer live source fetch where supported. |
| `clearCache` | Fetch immediately when refresh is authorized. Replace the cache after a non-empty result. |

普通单来源读取可以直接返回过期缓存，同时在后台更新。需要等待采集的单来源请求最多等待 4 秒。采集失败、超时或返回空列表时，接口返回已有历史条目。首次采集超时且没有历史条目时返回 HTTP 504。网页批量读取和阅读洞察已有缓存条目时，最多再等缺缓存的来源 200 毫秒。接口返回已取得的条目，并列出未完成的来源，采集在后台继续。没有缓存时，批量接口最多等待采集 4 秒。

Batch payload selectors:

| Field | Purpose |
| --- | --- |
| `sources` | Explicit source ID array. |
| `source` | Single source ID or source ID array. |
| `column` | Column ID or column ID array. |
| `type` | Source type or type array. |
| `since` | Optional timestamp filter. |
| `limit` | Optional item limit per source response. |

Example:

```bash
curl -X POST https://news.example.com/api/v1/sources/batch \
  -H "content-type: application/json" \
  -d '{"column":"tech","limit":20}'
```

### 定时刷新所有来源

第三方调度程序以 `POST` 调用 `/api/v1/sources/refresh`，无需请求体。默认按各来源的刷新间隔更新到期缓存。要重新采集全部可用来源，发送 `POST /api/v1/sources/refresh?force=true`，已有新鲜缓存的来源也会重新采集。

每次请求最多处理 3 个来源。每轮从无游标的请求开始。`meta.nextCursor` 有值时，将它作为下一次请求的 `cursor` 参数，串行请求，直到其值为 `null`。全量采集时，每一页都传入 `force=true`。来源按 ID 排序，范围包括当前部署可执行且已启用的来源。Cloudflare Pages 使用其构建支持的来源。Node 还包括启用的插件和配置型来源。重定向别名不单独采集。

请求头使用 `Authorization: Bearer <令牌>`。令牌必须与服务端 `LATESTNEWS_REFRESH_TOKEN` 一致，使用 32–128 位字母、数字、连字符或下划线。令牌独立于用户登录和 SyncHub。Pages 需要绑定可写的 D1 `LATESTNEWS_DB`。生成令牌及配置方式见[部署说明](deployment.md#定时刷新)。

第三方调度器可运行以下脚本。脚本使用 `curl` 和 `jq`。如有来源失败，脚本会处理完余下各页，再以非零退出码结束。将 `force` 设为 `true` 可执行全量采集。

```bash
set -eu
url='https://news.example.com/api/v1/sources/refresh'
force=false
cursor=''
failed=0
while :; do
  request_url="$url?force=$force"
  if [ -n "$cursor" ]; then
    request_url="$request_url&cursor=$cursor"
  fi
  result=$(curl -sS --fail-with-body -X POST "$request_url" \
    -H "Authorization: Bearer ${LATESTNEWS_REFRESH_TOKEN}")
  printf '%s\n' "$result" | jq -c '.data.sources[]'
  if printf '%s\n' "$result" | jq -e '.errors | length > 0' >/dev/null; then
    failed=1
  fi
  cursor=$(printf '%s\n' "$result" | jq -r '.meta.nextCursor // empty')
  [ -n "$cursor" ] || break
done
exit "$failed"
```

`meta.totalSources` 是当前部署中符合条件的来源总数。检查每页的 `data.sources` 和 `errors`。HTTP 200 表示该页处理完成，仍可能包含失败来源。

| `data.sources[].status` | 含义 |
| --- | --- |
| `refreshed` | 采集到条目并已写入缓存，`itemCount` 为写入条数。 |
| `fresh` | 缓存未达到该来源的刷新间隔，本次继续使用已有缓存。 |
| `empty` | 本次采集没有条目，保留旧缓存。 |
| `failed` | 采集或缓存写入失败，保留旧缓存，并在 `errors` 中返回来源 ID。 |

游标无效，或 `force` 的值超出 `true` 和 `false`，返回 HTTP 400。令牌缺失或错误返回 401。遇到令牌未配置、缓存不可用或服务停止采集时，服务返回 503。连接断开或服务停止后，可用相同游标重试。默认模式下，已写入且仍在刷新间隔内的来源返回 `fresh`。全量模式会再次采集该页。计划任务应串行处理各页，并在本轮结束后再启动下一轮。

## 登录能力

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/v1/auth/capability` | 返回 `{ "enable": true }` 或 `{ "enable": false }`。 |

## Health And Diagnostics

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/health/sources` | Filterable source-health snapshots. |
| `GET` | `/api/v1/health/diagnostics` | JSON diagnostics report envelope. |
| `GET` | `/api/v1/health/diagnostics?format=text` | Plain-text diagnostics report for issue reports or scripts. |

Health query parameters:

| Parameter | Values |
| --- | --- |
| `status` | `all`, `healthy`, `failing`, `idle`, `cache-degraded` |
| `adapterKind` | `all`, `legacy`, `plugin`, `configured` |
| `keyword` or `q` | Source name or ID search. |
| `limit` | Limit returned snapshots. |

Example:

```bash
curl "https://news.example.com/api/v1/health/sources?adapterKind=plugin&status=cache-degraded&limit=20"
```

## Feed Export

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/feeds/json` | JSON Feed export. |
| `GET` | `/api/v1/feeds/rss` | RSS 2.0 export. |

Supported feed filters follow the source batch selectors where applicable, including `source`, `column`, `type`, `since`, and `limit`.

## Auth And Public Access

LatestNews uses the authentication service at `VITE_API_URL` for account details and OAuth, and SyncHub for reading-data synchronization. These services define their own paths and authentication.

For private deployments, place any external access control at the platform layer unless the endpoint explicitly documents token handling.
