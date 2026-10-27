# Crawler plugin author tools

Each plugin directory contains a `manifest.json`, an entry file, and optional offline test data. The manifest declares the plugin identity, sources, supported hosts, and HTTPS origins that the host may request.

```text
my-plugin/
  manifest.json
  plugin.ts
  test-fixtures.json
  responses/
    latest.json
```

Run these commands from the repository root:

```powershell
pnpm crawler validate crawler-platform/examples/json
pnpm crawler test crawler-platform/examples/json
pnpm crawler bundle crawler-platform/examples/json --out out/plugins/example-json
```

`validate` checks the manifest and confirms that its entry resolves to a file inside the plugin directory. It does not import plugin code.

`test` bundles the entry, runs each case in a short-lived Node child process, and replies only with the local responses declared in `test-fixtures.json`. Set `responses` to an empty object when a plugin does not use `ctx.http`. Each case names a source and the output fields that it expects. A response uses either an inline `body` or a plugin-relative `bodyFile`. The test runner rejects paths outside the plugin directory and limits each response to 2 MiB and all fixture bodies to 8 MiB.

`bundle` writes `plugin.mjs`, a normalized `manifest.json`, and `artifact.json` with SHA-256 digests. It refuses to overwrite an existing output directory and refuses output inside the plugin source directory.

## Manifest resource limits

The optional `limits` object is normalized by the SDK. Older manifests remain valid and receive these defaults:

```json
{
  "limits": {
    "maxExecutionMs": 15000,
    "maxRequestsPerRun": 16,
    "maxRequestBodyBytes": 16384,
    "maxRequestHeadersBytes": 16384,
    "maxResponseBytes": 2097152,
    "maxResponseHeadersBytes": 16384,
    "maxResponseBytesPerRun": 8388608,
    "maxItems": 30,
    "maxOutputBytes": 262144
  }
}
```

The Node and Electron process hosts enforce the limits before forwarding a request or accepting a result. The in-process registry used by SDK tests applies the same request, response, and output budgets and aborts work at the manifest execution deadline. Hosts may impose a stricter deployment limit, but never widen the manifest. Credential headers such as `Authorization`, `Cookie`, and API key headers are reserved for a future host-managed credential capability. Exceeding a budget returns `RESOURCE_LIMIT` to the plugin. The current `trusted-js` runtime still assumes operator-reviewed code; these limits and the child process are execution boundaries, not a sandbox for unknown code.

## Package catalog and lifecycle

`crawler-platform/catalog.json` is a local, reviewed catalog. Each entry names a plugin ID, version, and source directory relative to that catalog file. The CLI checks catalog paths, manifest identity, and version before it builds a package. It does not run plugin code during installation.

```powershell
pnpm crawler catalog validate crawler-platform/catalog.json
pnpm crawler install crawler-platform/catalog.json org.latestnews.pcbeta --root .data/crawler-plugins --enable
pnpm crawler list --root .data/crawler-plugins
pnpm crawler update crawler-platform/catalog.json org.latestnews.pcbeta --root .data/crawler-plugins
pnpm crawler pin org.latestnews.pcbeta --root .data/crawler-plugins
pnpm crawler unpin org.latestnews.pcbeta --root .data/crawler-plugins
pnpm crawler rollback org.latestnews.pcbeta --root .data/crawler-plugins
pnpm crawler disable org.latestnews.pcbeta --root .data/crawler-plugins
```

The installer writes verified versions below `packages/<plugin-id>/versions/` and atomically selects the active version with `active.json`. It checks the manifest and bundle SHA-256 before the host loads code. Updates retain prior versions. A pin blocks updates and rollback until it is removed. Rollback switches the active pointer and does not delete packages. `enabled.json` is shared by Node and Electron. A flat package installed by the earlier workflow remains readable; pinning or updating it first copies it into the versioned store.

## Representative source migrations

The reviewed catalog now includes three static source migrations:

| Source | Adapter | Fixture | Compatibility contract |
| --- | --- | --- | --- |
| `freebuf` | RSS | `plugins/freebuf` | Existing source ID and URL hash |
| `juejin` | JSON | `plugins/juejin` | Existing source ID and article URL |
| `hackernews` | HTML | `plugins/hackernews` | Existing source ID, item URL, and score metadata |

Each package can be validated and replayed without network access. The host preserves the legacy `NewsItem.extra` presentation fields when a migrated adapter returns them.

## Node service integration

The first migrated source is Pcbeta's Windows 11 feed. Its plugin source ID remains `pcbeta-windows11`, and it uses the existing LatestNews URL hash helper contract so article history and cache IDs stay stable. By default the Node service reads enabled IDs from `.data/crawler-plugins/enabled.json`. A non-empty `LATESTNEWS_CRAWLER_PLUGIN_IDS` value overrides that file. Set `LATESTNEWS_CRAWLER_PLUGIN_DIR` only when the plugin store is not `.data/crawler-plugins`.

An enabled plugin replaces the legacy getter for its matching static source ID. A new channel appears in source discovery and can be requested through the single-source, detail, batch, Feed, and legacy ID APIs without editing `shared/sources.json`. The runtime source catalog sends dynamic source metadata to the Web client. If a plugin is not enabled, it does not appear in the catalog. The Node host allows up to four active plugin tasks and 64 queued tasks. It rejects overflow and tasks that exceed the queue wait limit. The Docker image includes the worker runtime file; the existing `.data` volume can hold the versioned plugin store. Run `pnpm test:crawler:docker` to build the local Docker image, install a deterministic fixture package into a temporary versioned store, and verify the dynamic source API. The command removes its temporary image, container, and plugin directory when it exits.

Cloudflare Pages remains the web deployment target. Pages Functions run on Cloudflare's Workers runtime. Its `node:child_process` module is a non-functional stub, so the Pages build selects an adapter that does not load the Node plugin host. When Web must read Node-hosted plugins, set the Pages build variable `VITE_NEWS_API_URL` to the Node API origin and set `LATESTNEWS_WEB_ORIGINS` on Node to the exact Pages origin. `VITE_API_URL` remains the authentication and user-sync endpoint. Do not enable Node plugin environment variables on Pages. ([Pages Functions](https://developers.cloudflare.com/pages/functions/), [Node.js compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/))

Pages Functions do not install or execute local plugin packages. The Web client reads runtime source metadata from the configured Node API. Operators must review a package and install it through the local CLI before enabling it.

## Electron desktop integration

The desktop renderer asks the main process for enabled local source IDs. Single-source, source-items, entire-source, and feed-batch requests prefer the configured remote API. Network failures and 5xx responses fall back to supported local plugins; 401, 403, 429 and valid empty responses do not. An empty remote origin selects local-only reading. The renderer sends only a source ID through IPC. The main process does not accept plugin paths or commands from the renderer.

`pnpm electron:plugins` builds four reviewed standalone packages: Pcbeta, FreeBuf, Juejin and Hacker News. Desktop build and dev commands run this step. Windows, macOS and Linux packages carry them outside `app.asar` under `resources/crawler-platform/builtin-plugins/`. A fresh plugin store installs and enables all four before source discovery. Existing stores receive only missing packages, without changing active versions, pins or enabled settings. An explicit `LATESTNEWS_CRAWLER_PLUGIN_DIR` remains operator-managed and skips seeding. Missing or invalid shipped resources do not prevent remote reading.

Use the same CLI store format for the desktop user's data directory:

```powershell
pnpm crawler install crawler-platform/catalog.json org.latestnews.pcbeta --root <userData>/crawler-plugins --enable
pnpm crawler list --root <userData>/crawler-plugins
pnpm crawler update crawler-platform/catalog.json org.latestnews.pcbeta --root <userData>/crawler-plugins
pnpm crawler rollback org.latestnews.pcbeta --root <userData>/crawler-plugins
```

`<userData>` is Electron's application data directory. Set `LATESTNEWS_CRAWLER_PLUGIN_DIR` to override the `crawler-plugins` root. The desktop package stores `worker-entry.mjs` outside `app.asar` under `resources/crawler-platform/runtime/`. If plugin settings or a package are invalid, the app logs the problem and continues in remote API mode. The app has no plugin installation screen yet.

The current `trusted-js` runtime is for code reviewed and trusted by the operator. The child process limits accidental environment leakage and isolates crashes, but it is not a security sandbox for untrusted code. Network permissions apply to requests made through the host API. They do not stop trusted plugin code from using other Node.js APIs directly.
