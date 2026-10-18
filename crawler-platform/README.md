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

`test` bundles the entry, runs each case in a short-lived Node child process, and replies only with the local responses declared in `test-fixtures.json`. Each case names a source and the output fields that it expects. A response uses either an inline `body` or a plugin-relative `bodyFile`. The test runner rejects paths outside the plugin directory and limits each response to 2 MiB and all fixture bodies to 8 MiB.

`bundle` writes `plugin.mjs`, a normalized `manifest.json`, and `artifact.json` with SHA-256 digests. It refuses to overwrite an existing output directory and refuses output inside the plugin source directory.

## Node service integration

The first migrated source is Pcbeta's Windows 11 feed. Its plugin source ID remains `pcbeta-windows11`, and it uses the existing LatestNews URL hash helper contract so article history and cache IDs stay stable.

Build the package into the Node server's data directory:

```powershell
pnpm crawler bundle crawler-platform/plugins/pcbeta --out .data/crawler-plugins/org.latestnews.pcbeta
```

Set `LATESTNEWS_CRAWLER_PLUGIN_IDS=org.latestnews.pcbeta` in the Node server environment. Set `LATESTNEWS_CRAWLER_PLUGIN_DIR` only when the package directory is not `.data/crawler-plugins`. The server loads only listed plugin IDs. It rejects missing packages, duplicate source IDs, unsupported targets, and source IDs that are not already present in `shared/sources.json`.

An enabled plugin replaces the legacy getter for its matching source ID. If the plugin is not enabled, the legacy getter continues to run. The Node host allows up to four active plugin tasks and 64 queued tasks. It rejects overflow and tasks that exceed the queue wait limit. The Docker image includes the worker runtime file; the existing `.data` volume can hold plugin bundles. Run `pnpm test:crawler:docker` to build the local Docker image, mount a deterministic fixture plugin, and verify the source API response. The command removes its temporary image, container, and plugin directory when it exits.

Cloudflare Pages remains the web deployment target. Pages Functions run on Cloudflare's Workers runtime. Its `node:child_process` module is a non-functional stub, so the Pages build selects an adapter that does not load the Node plugin host. Serve the UI from Pages and point `VITE_API_URL` at a Node API deployment when server-side plugins are enabled. Do not enable the Node plugin environment variables on Pages. ([Pages Functions](https://developers.cloudflare.com/pages/functions/), [Node.js compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/))

This first adapter preserves current source metadata and only replaces existing source IDs. It does not yet publish new runtime source IDs to the frontend. It also does not install packages from the web UI. Operators must review and build trusted packages before enabling them.

## Electron desktop integration

The desktop renderer asks the main process for enabled local source IDs. It uses those plugins for single-source, source-items, entire-source, and feed-batch requests. Other source IDs continue through the configured remote API. A local plugin failure falls back to the remote source. The renderer sends only a source ID through IPC. The main process does not accept plugin paths or commands from the renderer.

Copy a bundle to `<userData>/crawler-plugins/packages/<plugin-id>/` and add its ID to `<userData>/crawler-plugins/enabled.json`:

```json
{
  "enabledPluginIds": ["org.latestnews.pcbeta"]
}
```

`<userData>` is Electron's application data directory. Set `LATESTNEWS_CRAWLER_PLUGIN_DIR` to override the `crawler-plugins` root. The desktop package stores `worker-entry.mjs` outside `app.asar` under `resources/crawler-platform/runtime/`. If plugin settings or a package are invalid, the app logs the problem and continues in remote API mode. The app has no plugin installation screen yet.

The current `trusted-js` runtime is for code reviewed and trusted by the operator. The child process limits accidental environment leakage and isolates crashes, but it is not a security sandbox for untrusted code. Network permissions apply to requests made through the host API. They do not stop trusted plugin code from using other Node.js APIs directly.
