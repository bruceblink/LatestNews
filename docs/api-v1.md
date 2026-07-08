# LatestNews API v1

LatestNews exposes a small read-oriented API for automation, feed readers, diagnostics, and downstream collectors. All paths below are relative to the deployed site root and use the `/api` prefix at runtime.

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

Single-source metadata keeps item payloads out of discovery responses. If `{id}` is a redirect alias, `meta.canonicalSourceId` points to the source used by item endpoints and `meta.redirected` is `true`.

Single-source query parameters:

| Parameter | Purpose |
| --- | --- |
| `since` | Only return items at or after this timestamp. |
| `limit` | Limit item count. |
| `latest` | Prefer live source fetch where supported. |
| `clearCache` | Clear the source cache before fetching. |

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
| `keyword` or `q` | Source name or ID search. |
| `limit` | Limit returned snapshots. |

Example:

```bash
curl "https://news.example.com/api/v1/health/sources?status=cache-degraded&limit=20"
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
