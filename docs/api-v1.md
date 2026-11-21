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
| `POST` | `/api/v1/sources/refresh` | 遍历当前部署可采集的来源，并刷新到期缓存。 |

Single-source metadata keeps item payloads out of discovery responses. If `{id}` is a redirect alias, `meta.canonicalSourceId` points to the source used by item endpoints and `meta.redirected` is `true`.

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

第三方调度程序以 `POST` 调用 `/api/v1/sources/refresh`。首次调用无需请求体或查询参数。每次处理最多 3 个来源。`meta.nextCursor` 有值时，使用同一路径追加 `?cursor=<nextCursor>`，串行调用直到它为 `null`。每轮定时任务从无游标的请求开始。启用的来源按 ID 排序，重定向别名、已停用来源和当前部署无法执行的来源不进入本轮。Cloudflare Pages 只采集其构建支持的来源。

请求头使用 `Authorization: Bearer <令牌>`。令牌必须与服务端 `LATESTNEWS_REFRESH_TOKEN` 一致，使用 32–128 位字母、数字、连字符或下划线。令牌独立于用户登录和 SyncHub。Pages 需要绑定可写的 D1 `LATESTNEWS_DB`。生成令牌及配置方式见[部署说明](deployment.md#定时刷新)。

第三方调度器可运行以下脚本。它使用 `curl` 和 `jq`，一轮结束后会以非零退出码报告本轮出现的采集失败。

```bash
set -eu
url='https://news.example.com/api/v1/sources/refresh'
cursor=''
failed=0
while :; do
  request_url="$url"
  if [ -n "$cursor" ]; then
    request_url="$url?cursor=$cursor"
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

游标无效返回 HTTP 400，令牌缺失或错误返回 401，服务未配置令牌或缓存不可用返回 503。单次请求中断时可用相同游标重试。已写入且仍在刷新间隔内的来源会返回 `fresh`。计划任务应串行处理各页，并避免同一轮尚未结束时启动下一轮。

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

The read-only v1 endpoints above are public when login is disabled. User sync endpoints such as `/api/me` remain private and require a valid deployment configuration.

For private deployments, place any external access control at the platform layer unless the endpoint explicitly documents token handling.
