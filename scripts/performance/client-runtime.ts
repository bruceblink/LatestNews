import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { cpus, tmpdir, totalmem } from "node:os";
import { execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { join, extname, resolve, relative, isAbsolute } from "node:path";
import { createServer, type ServerResponse, type IncomingMessage } from "node:http";
import { rm, mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { chromium, _electron, type Page, type BrowserContext, type ElectronApplication } from "@playwright/test";

import { createNewsInsights } from "../../shared/news-insights";

import type { SourceResponse } from "../../shared/types";

const root = resolve(import.meta.dirname, "../..");
const platform = process.argv[2];
const mode = process.argv[3] ?? "startup";
const requestedSeconds = Number(process.argv[4] ?? 1800);
if (
    !["web", "electron"].includes(platform) ||
    !["startup", "endurance"].includes(mode) ||
    !Number.isInteger(requestedSeconds) ||
    requestedSeconds < 1 ||
    requestedSeconds > 3600
) {
    throw new Error("Usage: client-runtime.ts web|electron startup|endurance [seconds=1800]");
}
const web = platform === "web";
const staticRoot = join(root, "dist");
const temp = await mkdtemp(join(tmpdir(), "latestnews-client-runtime-"));
const generatedAt = Date.now();
const count = 30;
const items = Array.from({ length: count }, (_, n) => ({
    id: "client-" + n,
    title: "Client runtime fixture headline " + String(n).padStart(2, "0"),
    url: "https://example.test/client/" + n,
    pubDate: generatedAt - n * 60000,
}));
const title = items[0].title;
const sourceId = "hackernews";
const catalog = {
    id: sourceId,
    name: "Hacker News",
    interval: 600000,
    color: "slate",
    type: "normal",
    disabled: false,
    home: "https://news.ycombinator.com/",
};
const rows: SourceResponse[] = [
    { status: "success", id: sourceId, name: "Hacker News", updatedTime: generatedAt, items },
];
const archive = items.map((item) => ({
    articleKey: "article-v2-" + item.id,
    canonicalUrl: item.url,
    title: item.title,
    publishedAt: item.pubDate,
    eventId: "event-v2-client-runtime",
    sourceIds: [sourceId],
    item,
}));
const insights = createNewsInsights(rows, { generatedAt });
const health = {
    meta: { generatedAt, totalSourceCount: 1, healthyCount: 1, failingCount: 0, idleCount: 0, cacheDegradedCount: 0 },
    data: [
        {
            id: sourceId,
            name: "Hacker News",
            status: "healthy",
            successCount: 1,
            errorCount: 0,
            consecutiveFailures: 0,
            cacheDegraded: false,
            lastDurationMs: 12,
            lastSuccessAt: generatedAt,
            lastItemCount: count,
            recentEvents: [],
        },
    ],
    errors: [],
};
const apiCounts: Record<string, number> = {};
let activeRequests = 0,
    maxActiveRequests = 0,
    unexpectedRequests = 0,
    staticErrors = 0;
const server = createServer((req, res) => {
    activeRequests++;
    maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
    res.once("close", () => activeRequests--);
    void serve(req, res).catch((error) => {
        staticErrors++;
        if (!res.headersSent) res.writeHead(500);
        res.end(String(error));
    });
});
function json(res: ServerResponse, body: unknown, status = 200) {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(body));
}
const baseMeta = { generatedAt, requestedSourceCount: 1, resolvedSourceCount: 1, partial: false, omittedSourceIds: [] };
async function serve(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const path = url.pathname.replace(/^\/api(?=\/|$)/, "");
    if (url.pathname.startsWith("/api/") || path.startsWith("/v1/")) {
        apiCounts[path] = (apiCounts[path] ?? 0) + 1;
        // Drain the bounded fixture request body before responding.
        let bytes = 0;
        for await (const chunk of req) {
            bytes += Buffer.byteLength(chunk);
            if (bytes > 1024 * 1024) {
                json(res, {}, 413);
                return undefined;
            }
        }
        if (path === "/v1/sources")
            return json(res, {
                data: { sources: [catalog], columns: [] },
                meta: { generatedAt, sourceCount: 1, redirectCount: 0, disabledCount: 0, columnCount: 0 },
                errors: [],
            });
        if (path === "/v1/insights") return json(res, { data: insights, meta: baseMeta, errors: [] });
        if (path === "/v1/sources/batch")
            return json(res, {
                data: rows,
                meta: { ...baseMeta, itemCount: count, unfilteredItemCount: count },
                errors: [],
            });
        if (path === "/v1/sources/hackernews")
            return json(res, {
                data: catalog,
                meta: { generatedAt, sourceId, canonicalSourceId: sourceId, redirected: false },
                errors: [],
            });
        if (path === "/v1/sources/hackernews/items")
            return json(res, {
                data: rows[0],
                meta: { generatedAt, sourceId, status: "success", itemCount: count, unfilteredItemCount: count },
                errors: [],
            });
        if (path === "/v1/articles/search")
            return json(res, {
                data: { status: "ok", searchMode: "fts", items: archive },
                meta: { generatedAt, itemCount: count, limit: 50 },
                errors: [],
            });
        if (path === "/v1/events/event-v2-client-runtime")
            return json(res, {
                data: { eventId: "event-v2-client-runtime", registeredAt: generatedAt, items: archive },
                meta: { generatedAt, itemCount: count, limit: 30 },
                errors: [],
            });
        if (path === "/v1/health/sources") return json(res, health);
        if (path === "/v1/health/deployment") return json(res, { data: { status: "ready" }, errors: [] });
        if (path === "/v1/auth/capability") return json(res, { data: { enabled: false }, errors: [] });
        if (path === "/me") return json(res, { status: "unauthenticated", data: null });
        unexpectedRequests++;
        return json(res, { data: [], errors: [] });
    }
    let file = resolve(staticRoot, "." + decodeURIComponent(url.pathname));
    if (!extname(file) || url.pathname.endsWith("/")) file = join(staticRoot, "index.html");
    const rel = relative(staticRoot, file);
    if (!rel || rel === ".." || rel.startsWith("../") || rel.startsWith("..\\") || isAbsolute(rel)) {
        res.writeHead(404).end();
        return undefined;
    }
    try {
        const body = await readFile(file);
        const types: Record<string, string> = {
            ".html": "text/html",
            ".js": "application/javascript",
            ".css": "text/css",
            ".json": "application/json",
            ".webmanifest": "application/manifest+json",
            ".svg": "image/svg+xml",
            ".png": "image/png",
            ".woff2": "font/woff2",
            ".ico": "image/x-icon",
        };
        res.writeHead(200, {
            "Content-Type": types[extname(file)] ?? "application/octet-stream",
            "Cache-Control": extname(file) === ".html" || file.endsWith("sw.js") ? "no-store" : "public, max-age=3600",
            "Content-Length": body.length,
        });
        res.end(req.method === "HEAD" ? undefined : body);
    } catch {
        staticErrors++;
        res.writeHead(404).end();
    }
    return undefined;
}
await new Promise<void>((done, fail) => {
    server.once("error", fail);
    server.listen(0, "127.0.0.1", done);
});
const address = server.address();
assert.ok(address && typeof address !== "string");
const origin = "http://127.0.0.1:" + address.port;
const appOrigin = web ? origin : "app://bundle";
const processArgs = [
    "--no-sandbox",
    "--disable-gpu",
    "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1",
    "--proxy-server=http://127.0.0.1:1",
    "--proxy-bypass-list=127.0.0.1;localhost",
];
const round = (n: number) => Math.round(n * 1000) / 1000;
let context: BrowserContext | undefined, desktop: ElectronApplication | undefined;
let errors: string[] = [];
let page: Page | undefined;
let browserVersion = "";
async function launch(profile: string) {
    await mkdir(profile, { recursive: true });
    if (!web) await writeFile(join(profile, "news-api-config.json"), JSON.stringify({ url: origin, mode: "remote" }));
    errors = [];
    const start = performance.now();
    if (web) {
        context = await chromium.launchPersistentContext(profile, {
            headless: true,
            args: processArgs,
            viewport: { width: 1440, height: 900 },
            serviceWorkers: "block",
        });
        page = context.pages()[0] ?? (await context.newPage());
        browserVersion = context.browser()?.version() ?? "Chromium persistent context";
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto(appOrigin + "/");
    } else {
        desktop = await _electron.launch({
            args: [...processArgs, "--user-data-dir=" + profile, join(root, "out")],
            executablePath:
                process.env.LATESTNEWS_ELECTRON_EXECUTABLE ?? join(root, "node_modules/electron/dist/electron"),
            timeout: 60000,
            env: { ...process.env, LATESTNEWS_CRAWLER_PLUGIN_DIR: join(profile, "plugins") },
        });
        page = await desktop.firstWindow();
        page.on("pageerror", (error) => errors.push(error.message));
        browserVersion = await desktop.evaluate(() => process.versions.electron ?? "unknown");
    }
    await page.getByRole("heading", { name: "阅读洞察", level: 1 }).waitFor({ timeout: 30000 });
    const shellMs = round(performance.now() - start);
    await page.getByRole("link", { name: title, exact: true }).first().waitFor({ timeout: 30000 });
    return { shellMs, contentMs: round(performance.now() - start) };
}
async function close() {
    if (desktop) {
        const app = desktop;
        desktop = undefined;
        await app.close();
    }
    if (context) {
        const current = context;
        context = undefined;
        await current.close();
    }
    page = undefined;
}
async function rendererMetrics() {
    assert.ok(page);
    const session = await page.context().newCDPSession(page);
    try {
        await session.send("Performance.enable");
        const response = await session.send("Performance.getMetrics");
        const metrics = Object.fromEntries(response.metrics.map((m) => [m.name, m.value]));
        const dom = await session.send("Memory.getDOMCounters");
        return {
            heapUsedBytes: metrics.JSHeapUsedSize,
            heapTotalBytes: metrics.JSHeapTotalSize,
            documents: dom.documents,
            nodes: dom.nodes,
            jsEventListeners: dom.jsEventListeners,
            taskDurationSeconds: metrics.TaskDuration,
        };
    } finally {
        await session.detach();
    }
}
async function desktopMetrics() {
    if (!desktop) return undefined;
    return desktop.evaluate(({ app, BrowserWindow }) => ({
        processes: app.getAppMetrics().map((m) => ({
            type: m.type,
            pid: m.pid,
            workingSetKiB: m.memory.workingSetSize,
            cpuPercent: m.cpu.percentCPUUsage,
        })),
        windows: BrowserWindow.getAllWindows().length,
    }));
}
async function rssForProfile(profile: string) {
    // Include only browser/Electron descendants of processes carrying this isolated profile.
    // Read Linux procfs without assuming a Chromium executable name.
    const procs = new Map<number, { parent: number; rssKiB: number; cmdline: string }>();
    for (const name of await readdir("/proc")) {
        if (!/^\d+$/.test(name)) continue;
        try {
            const status = await readFile("/proc/" + name + "/status", "utf8");
            const parent = Number(status.match(/^PPid:\s+(\d+)/m)?.[1] ?? 0);
            const rssKiB = Number(status.match(/^VmRSS:\s+(\d+)/m)?.[1] ?? 0);
            const cmdline = await readFile("/proc/" + name + "/cmdline", "utf8");
            procs.set(Number(name), { parent, rssKiB, cmdline });
        } catch {
            /* process exited */
        }
    }
    const ids = new Set(
        [...procs].filter(([, p]) => p.cmdline.split("\0").includes("--user-data-dir=" + profile)).map(([pid]) => pid)
    );
    let changed = true;
    while (changed) {
        changed = false;
        for (const [pid, p] of procs) {
            if (ids.has(p.parent) && !ids.has(pid)) {
                ids.add(pid);
                changed = true;
            }
        }
    }
    return { processCount: ids.size, rssKiB: [...ids].reduce((sum, id) => sum + procs.get(id)!.rssKiB, 0) };
}
async function snapshot(profile: string) {
    const renderer = await rendererMetrics();
    assert.ok(Number.isFinite(renderer.heapUsedBytes) && renderer.heapUsedBytes > 0);
    const process = await rssForProfile(profile);
    assert.ok(process.processCount > 0 && process.rssKiB > 0);
    const native = await desktopMetrics();
    return { ...renderer, ...process, ...(native ? { native } : {}), pendingFixtureRequests: activeRequests };
}
async function select(label: string, heading: string) {
    assert.ok(page);
    const start = performance.now();
    await page.getByRole("navigation", { name: "主要页面" }).getByRole("link", { name: label, exact: true }).click();
    await page.getByRole("heading", { name: heading, level: 1 }).waitFor({ timeout: 15000 });
    return round(performance.now() - start);
}
async function cycle(readIndex = 0) {
    assert.ok(page);
    const times: number[] = [];
    const item = items[readIndex % count];
    times.push(await select("统一 Feed", "统一 Feed"));
    const readingLink = page.getByRole("link", { name: new RegExp(item.title) }).first();
    await readingLink.waitFor({ timeout: 15000 });
    const readStart = performance.now();
    if (web) {
        const popup = page.waitForEvent("popup", { timeout: 15000 });
        await readingLink.click();
        await (await popup).close();
    } else {
        await readingLink.click();
    }
    times.push(round(performance.now() - readStart));
    times.push(await select("新闻档案", "新闻档案"));
    await page.getByLabel("关键词").fill("fixture");
    await page.getByRole("button", { name: "检索历史文章" }).click();
    await page
        .getByRole("link", { name: new RegExp(title) })
        .first()
        .waitFor({ timeout: 15000 });
    await page.getByRole("link", { name: "查看事件历史" }).first().click();
    await page.getByRole("heading", { name: "事件历史" }).waitFor({ timeout: 15000 });
    await page
        .getByRole("link", { name: new RegExp(title) })
        .first()
        .waitFor({ timeout: 15000 });
    times.push(await select("阅读历史", "阅读历史"));
    await page.getByText(item.title, { exact: true }).first().waitFor({ timeout: 15000 });
    times.push(await select("首页", "阅读洞察"));
    await page
        .getByRole("link", { name: new RegExp(title) })
        .first()
        .waitFor({ timeout: 15000 });
    return times;
}
async function quiet() {
    const deadline = performance.now() + 10000;
    while (activeRequests > 0) {
        if (performance.now() > deadline) throw new Error("Fixture request drain exceeded deadline");
        await delay(20);
    }
}
const gitCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const sha = async (path: string) =>
    createHash("sha256")
        .update(await readFile(path))
        .digest("hex");
const artifact = web ? join(staticRoot, "index.html") : join(root, "out/main/main.cjs");
const report: Record<string, unknown> = {
    platform,
    mode,
    gitCommit,
    artifactSha256: await sha(artifact),
    environment: {
        node: process.version,
        platform: process.platform,
        architecture: process.arch,
        cpu: cpus()[0]?.model,
        cores: cpus().length,
        ramBytes: totalmem(),
    },
    profile: "isolated",
    fixture: {
        articles: count,
        source: sourceId,
        network: "loopback fixture; external destinations blocked via Chromium proxy",
        serviceWorkers: web ? "blocked" : "desktop adapter",
        gpu: "disabled",
    },
    startedAt: new Date().toISOString(),
};
const reportPath = join(root, ".data/performance", `client-${platform}-${mode}-${Date.now()}.json`);
await mkdir(join(root, ".data/performance"), { recursive: true });
try {
    if (mode === "startup") {
        const runs = [];
        for (let i = 0; i < 5; i++) {
            const profile = join(temp, "pair-" + i);
            for (const state of ["cold", "warm"]) {
                const countsBefore = Object.values(apiCounts).reduce((a, b) => a + b, 0);
                const timing = await launch(profile);
                await quiet();
                const metrics = await snapshot(profile);
                assert.equal(errors.length, 0, errors.join("; "));
                runs.push({
                    pair: i + 1,
                    state,
                    ...timing,
                    ...metrics,
                    apiRequests: Object.values(apiCounts).reduce((a, b) => a + b, 0) - countsBefore,
                });
                await close();
                await quiet();
                console.log(platform, state, i + 1, JSON.stringify(timing));
            }
        }
        report.runs = runs;
    } else {
        const profile = join(temp, "endurance");
        report.startup = await launch(profile);
        if (context)
            await context.route("https://example.test/client/**", (route) =>
                route.fulfill({
                    contentType: "text/html",
                    body: "<html><title>Fixture article</title>Local test article</html>",
                })
            );
        if (desktop)
            await desktop.evaluate(({ shell }) => {
                Object.defineProperty(shell, "openExternal", {
                    configurable: true,
                    value: Promise.resolve.bind(Promise, undefined),
                });
            });
        report.externalOpen = "fixture only; web popup intercepted and closed, Electron shell opener mocked";
        report.cycleTimingOrder = [
            "feed navigation",
            "read action",
            "archive navigation",
            "history navigation",
            "insights navigation",
        ];
        // Warm up one complete route cycle before measuring the fixed-duration run.
        await cycle();
        await quiet();
        const start = performance.now();
        const samples = [{ elapsedSeconds: 0, ...(await snapshot(profile)) }];
        const cycles: number[][] = [];
        report.samples = samples;
        report.cycles = cycles;
        let nextSample = 60;
        while (performance.now() - start < requestedSeconds * 1000) {
            const cycleStart = performance.now();
            cycles.push(await cycle(cycles.length));
            assert.equal(errors.length, 0, errors.join("; "));
            await quiet();
            const elapsed = (performance.now() - start) / 1000;
            if (elapsed >= nextSample) {
                samples.push({ elapsedSeconds: round(elapsed), ...(await snapshot(profile)) });
                nextSample += 60;
                console.log(platform, "elapsed", round(elapsed), "cycles", cycles.length);
            }
            const remaining = requestedSeconds * 1000 - (performance.now() - start);
            await delay(Math.max(0, Math.min(remaining, 15000 - (performance.now() - cycleStart))));
        }
        await quiet();
        const elapsedSeconds = round((performance.now() - start) / 1000);
        samples.push({ elapsedSeconds, ...(await snapshot(profile)) });
        assert.ok(elapsedSeconds >= requestedSeconds);
        assert.equal(errors.length, 0, errors.join("; "));
        report.requestedSeconds = requestedSeconds;
        report.elapsedSeconds = elapsedSeconds;
        report.cycles = cycles;
        report.samples = samples;
        await close();
        await quiet();
        const afterClose = await rssForProfile(profile);
        report.afterClose = afterClose;
        assert.equal(afterClose.processCount, 0, "Profile-associated processes remained after close");
    }
    assert.equal(activeRequests, 0);
    assert.equal(staticErrors, 0);
    assert.equal(unexpectedRequests, 0, "Unexpected fixture API requests");
    report.result = "passed";
} catch (error) {
    report.result = "failed";
    report.failure = String(error);
    report.pageErrors = errors.slice(0, 10);
    throw error;
} finally {
    try {
        await close();
    } finally {
        server.closeAllConnections();
        await new Promise<void>((done) => server.close(() => done()));
        report.browserVersion = browserVersion;
        report.apiCounts = apiCounts;
        report.maxActiveRequests = maxActiveRequests;
        report.pendingFixtureRequests = activeRequests;
        report.unexpectedRequests = unexpectedRequests;
        report.staticErrors = staticErrors;
        await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
        console.log("report", reportPath, report.result);
        await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
}
