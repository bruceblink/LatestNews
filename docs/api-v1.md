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
- `errors`: non-fatal errors, especially for partial source responses. Source collection errors retain `sourceId` and `message`; an optional `code` classifies the failure (for example `TIMEOUT`, `HTTP_FAILED`, `QUEUE_FULL`, `INVALID_OUTPUT`, `RESOURCE_LIMIT`, `UNKNOWN`). These are fixed public messages or numeric HTTP status text, not the original exception. Consumers must accept unknown future codes and must not parse message text as a stable protocol.

## Node Discovery

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/node` | Node identity, version, endpoint map, source catalog, and health counters. |
| `GET` | `/api/v1/openapi.json` | Machine-readable OpenAPI 3.1 contract for public v1 endpoints. |
| `GET` | `/api/v1/health/deployment` | Deployment readiness across app, cache, source-health and article-index state. |

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
| `GET` | `/api/v1/articles/search` | 查询 Node SQLite / Pages D1 文章索引中的历史文章。使用 `q`，可选 `source`、`since` 和 `limit`。 |
| `GET` | `/api/v1/events/{eventId}` | 查询已注册事件的历史文章和来源映射。 |

洞察响应的 `data.topicEvents[]` 保留展示 ID `id` 和 `eventId`，新增可选 `identityStatus`。旧客户端继续读取 `id`。洞察只读取持久归属，不依据展示过滤、来源选择或请求顺序改变归属。只有 `registered`（全部规范 URL 已归属同一已注册规范事件）才可进入历史详情；`candidate`（未归属）、`partial`（部分归属）、`conflict`（多个规范事件）、`unavailable`（索引/注册不可用）返回展示候选 ID，不能视为历史事件。服务端候选 ID 使用 `candidate-v2-` 与排序去重成员 SHA-256；本地计算结果及旧版本 ID 不保证已注册。新持久归属仅经受控人工审批。

### 历史文章检索

`GET /api/v1/articles/search?q=AI%20模型&limit=30`。q 去除首尾空白后必须为 1–256 个 UTF-16 code unit。中文及中英混合查询使用字面子串，空白分隔词必须全部命中标题或全部命中已存储规范 URL；标题完整相等、连续短语、分散词、仅 URL 依次排序，时间及主键用于同等级排序。正常英文查询继续用 FTS5/BM25。响应 searchMode 保留 fts/like/unavailable（不可用时 HTTP 503）；like 为字面回退模式，不将 % 或 _ 当作通配符。此接口不提供语义相似度。

历史索引的 publishedAt 为 UTC 毫秒；未知时间不输出该字段。since 接受正数秒/毫秒、带时区 ISO 时间或 UTC 日期，指定 since 时只返回已知且不早于该时刻的文章（未知时间不参与筛选结果）。原始 item 字段保持现有表示。相同规范 URL 复用已存在 articleKey；不同 URL 即使共享来源原始 ID 或指纹，也不会覆盖旧文章及事件归属。旧数据库须完成 N4-L1 迁移后再关闭 INIT_TABLE。

部署健康接口 checks.articleIndex 是可选扩展，报告 status、fts、pendingIngest、pendingFts、eventRegistry 和 untrackedCache。来源缓存可用不代表历史索引完整；已知积压或修复期间历史检索可降级为 like，结果可能不完整。健康状态不代替全库完整性审计。

### 历史事件查询

`GET /api/v1/events/{eventId}?limit=30` 返回 `data.eventId`、`data.registeredAt`（毫秒时间戳，表示注册表首次写入时间而非新闻发布时间）和 `data.items`（沿用文章搜索的条目格式）。事件历史独立于当前来源缓存。默认 30 条，`limit` 允许 1–100。若返回 `meta.nextCursor`，将该值作为同一事件下一页的 `after` 参数；省略时从第一页开始。分页按文章主键稳定排序，不是发布时间排序；并发新增文章时不保证跨页固定快照。

`400` 表示 ID 或分页参数无效；`404` 表示 ID 尚未注册（包括仅计算出的候选 ID）；`503` 表示索引、注册表或旧成员迁移不可用。此接口仅支持已启用索引及注册表的 Node/Pages 部署；Electron 本地 JSON 缓存不提供历史注册表，连接远端服务时按远端能力使用。该接口不重新聚类，不提供客户端修改注册表的入口。若请求 ID 是人工批准的别名，响应额外提供 `data.canonicalEventId`，并按规范 ID 及其别名读取成员；`data.eventId` 保留请求 ID，成员 `eventId` 保留原始关联。未批准的事件仍独立。

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

Source health `lastErrorMessage` and recent event `errorMessage` contain bounded, fixed public text. Raw exception messages, stacks, URLs with query parameters, credentials, and response bodies are not part of these fields. Historic stored event messages are safely projected when read; old database rows are not implicitly rewritten. Health counters, status and cache-degradation behavior are unchanged. Node manifests and federation diagnostics expose aggregate local health rather than raw source exceptions.

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
