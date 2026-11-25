import { tmpdir } from "node:os";
import { once } from "node:events";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { spawn, type ChildProcess } from "node:child_process";
import { rm, mkdir, access, mkdtemp, copyFile } from "node:fs/promises";

import { bundlePluginPackage } from "../../crawler-platform/cli";
import { installCrawlerPluginPackage } from "../../crawler-platform/host/plugin-store";

import type { DeploymentHealthResponse } from "../../shared/deployment-health";
import type { SourceBatchResponse, SourceItemsResponse, ArticleSearchResponse } from "../../shared/source-api";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const entry = join(root, "dist/output/server/index.mjs");
await access(entry);
const temp = await mkdtemp(join(tmpdir(), "latestnews-node-host-smoke-"));
const plugin = "org.latestnews.server-smoke";
const source = "ext." + plugin + ".latest";
const itemPath = "/api/v1/sources/" + encodeURIComponent(source) + "/items";
const queryPath = "/api/v1/articles/search?q=Server%20plugin%20API%20smoke&source=" + encodeURIComponent(source);
let child: ChildProcess | undefined;
let logs = "";

try {
    const working = join(temp, "work");
    const store = join(temp, "plugins");
    await mkdir(join(working, "crawler-platform/runtime"), { recursive: true });
    await mkdir(join(temp, "home"), { recursive: true });
    await copyFile(
        join(root, "crawler-platform/runtime/worker-entry.mjs"),
        join(working, "crawler-platform/runtime/worker-entry.mjs")
    );
    await bundlePluginPackage(join(root, "test/fixtures/crawler-server-smoke"), join(temp, "bundle"));
    await installCrawlerPluginPackage(join(temp, "bundle"), store, { action: "install", enable: true });

    const listener = createServer();
    listener.listen(0, "127.0.0.1");
    await once(listener, "listening");
    const address = listener.address();
    assert.ok(address && typeof address !== "string");
    const port = address.port;
    await new Promise<void>((done, fail) => listener.close((error) => (error ? fail(error) : done())));
    const origin = "http://127.0.0.1:" + port;
    async function request<T>(path: string, init?: RequestInit, expected = 200): Promise<T> {
        const response = await fetch(origin + path, { ...init, signal: AbortSignal.timeout(5000) });
        const body = (await response.json()) as T;
        assert.equal(response.status, expected, JSON.stringify(body));
        return body;
    }
    async function start() {
        logs = "";
        child = spawn(process.execPath, [entry], {
            cwd: working,
            env: {
                PATH: process.env.PATH,
                SystemRoot: process.env.SystemRoot,
                NODE_ENV: "production",
                HOST: "127.0.0.1",
                NITRO_HOST: "127.0.0.1",
                PORT: String(port),
                NITRO_PORT: String(port),
                HOME: join(temp, "home"),
                ENABLE_CACHE: "true",
                INIT_TABLE: "true",
                LATESTNEWS_CRAWLER_PLUGIN_DIR: store,
                LATESTNEWS_CRAWLER_PLUGIN_IDS: plugin,
                LATESTNEWS_WEB_ORIGINS: "https://news.example.test",
            },
            stdio: ["ignore", "pipe", "pipe"],
        });
        for (const stream of [child.stdout, child.stderr])
            stream?.on("data", (data) => {
                logs = (logs + String(data)).slice(-16000);
            });
        for (let i = 0; i < 100; i++) {
            if (child.exitCode !== null || child.signalCode !== null) throw new Error("Node exited before readiness");
            try {
                const health = await request<DeploymentHealthResponse>("/api/v1/health/deployment");
                assert.equal(health.data.checks.cache.status, "ok");
                assert.equal(health.data.checks.articleIndex?.status, "ok");
                return;
            } catch (error) {
                if (i === 99) throw error;
                await delay(200);
            }
        }
    }
    await start();
    const catalog = await request<{ data: { sources: Array<{ id: string }> } }>("/api/v1/sources");
    assert.ok(catalog.data.sources.some((item) => item.id === source));
    const first = await request<SourceItemsResponse>(itemPath);
    assert.equal(first.data.status, "success");
    assert.equal(first.data.items[0]?.id, "server-smoke-1");
    // A source response may precede its background index commit.
    let indexed: ArticleSearchResponse | undefined;
    for (let i = 0; i < 50; i++) {
        indexed = await request<ArticleSearchResponse>(queryPath);
        if (indexed.data.items.length) break;
        await delay(100);
    }
    assert.equal(indexed?.data.items.length, 1);
    const key = indexed!.data.items[0].articleKey;
    assert.equal(indexed!.data.items[0].item.id, "server-smoke-1");
    const batch = await request<SourceBatchResponse>("/api/v1/sources/batch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sources: [source] }),
    });
    assert.equal(batch.meta.partial, false);
    assert.equal(batch.data[0]?.status, "cache");
    assert.equal(batch.data[0]?.items[0]?.id, "server-smoke-1");
    const cors = await fetch(origin + "/api/v1/sources", {
        method: "OPTIONS",
        headers: { Origin: "https://news.example.test", "Access-Control-Request-Method": "GET" },
    });
    assert.equal(cors.status, 204);
    assert.equal(cors.headers.get("access-control-allow-origin"), "https://news.example.test");
    await request("/api/v1/sources/unknown-fixture-source/items", undefined, 400);
    await stop();
    await start();
    const after = await request<SourceItemsResponse>(itemPath);
    assert.equal(after.data.status, "cache");
    assert.deepEqual(after.data.items, first.data.items);
    const persisted = await request<ArticleSearchResponse>(queryPath);
    assert.equal(persisted.data.items.length, 1);
    assert.equal(persisted.data.items[0].articleKey, key);
    console.log(
        JSON.stringify({
            result: "passed",
            fixture: plugin,
            checks: [
                "catalog",
                "cold",
                "index",
                "batch-cache",
                "cors",
                "unknown-source",
                "restart-cache",
                "restart-identity",
            ],
        })
    );
} catch (error) {
    console.error(logs);
    throw error;
} finally {
    await stop();
    await rm(temp, { recursive: true, force: true });
}

async function stop() {
    const process = child;
    if (!process) return;
    child = undefined;
    if (process.exitCode !== null || process.signalCode !== null) return;
    const exited = once(process, "exit");
    process.kill("SIGTERM");
    const graceful = await Promise.race([exited.then(() => true), delay(3000, false)]);
    if (!graceful) {
        process.kill("SIGKILL");
        await exited;
    }
}
