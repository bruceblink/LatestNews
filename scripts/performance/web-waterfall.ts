import { execFileSync } from "node:child_process";
import { chromium, type Request } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, resolve, relative, isAbsolute } from "node:path";
import { createServer, type ServerResponse, type IncomingMessage } from "node:http";

const projectRoot = resolve(import.meta.dirname, "../..");
const staticRoot = resolve(process.env.LATESTNEWS_WEB_WATERFALL_ROOT?.trim() || "dist");
const fixtureItem = {
    id: "waterfall-fixture-1",
    title: "Web waterfall fixture headline",
    url: "https://example.test/waterfall-fixture-1",
    pubDate: "2026-11-04T00:00:00.000Z",
};

const mimeTypes: Record<string, string> = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".map": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".ttf": "font/ttf",
    ".webmanifest": "application/manifest+json",
    ".woff2": "font/woff2",
};

interface WaterfallEntry {
    url: string;
    path: string;
    resourceType: string;
    method: string;
    status?: number;
    failure?: string;
    requestStartMs: number;
    responseStartMs?: number;
    responseEndMs?: number;
    durationMs?: number;
    requestBodyBytes: number;
    responseBodyBytes: number;
}

interface RequestRecord {
    request: Request;
    entry: WaterfallEntry;
}

const server = createServer((request, response) => {
    void serveRequest(request, response).catch((error: unknown) => {
        if (!response.headersSent) response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        response.end(error instanceof Error ? error.message : "Request failed.");
    });
});

await mkdir(resolve(projectRoot, ".data/performance"), { recursive: true });
await listen(server);

const address = server.address();
if (!address || typeof address === "string") throw new Error("Web waterfall server did not bind a port.");

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const records = new Map<Request, RequestRecord>();
const pendingCaptures = new Set<Promise<void>>();

page.on("request", (request) => {
    records.set(request, {
        request,
        entry: {
            url: request.url(),
            path: new URL(request.url()).pathname,
            resourceType: request.resourceType(),
            method: request.method(),
            requestStartMs: 0,
            requestBodyBytes: Buffer.byteLength(request.postData() ?? ""),
            responseBodyBytes: 0,
        },
    });
});
page.on("requestfinished", (request) => {
    const task = captureFinishedRequest(request);
    pendingCaptures.add(task);
    void task.then(
        () => pendingCaptures.delete(task),
        () => pendingCaptures.delete(task)
    );
});
page.on("requestfailed", (request) => {
    const record = records.get(request);
    if (!record) return;
    record.entry.failure = request.failure()?.errorText ?? "request failed";
});

try {
    const navigationStartedAt = Date.now();
    await page.goto(`http://127.0.0.1:${address.port}/feed`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "统一 Feed", level: 1 }).waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForTimeout(500);
    await Promise.all([...pendingCaptures]);

    const entries = normalizeEntries([...records.values()].map(({ entry }) => entry));
    const report = {
        result: "passed",
        capturedAt: new Date().toISOString(),
        git: readGitState(),
        runtime: {
            node: process.version,
            platform: process.platform,
            architecture: process.arch,
        },
        target: `http://127.0.0.1:${address.port}/feed`,
        navigationMs: Date.now() - navigationStartedAt,
        page: await page.evaluate(() => {
            const browserGlobal = globalThis as unknown as {
                document: { title: string; readyState: string };
                performance: { getEntriesByType(type: string): Array<{ toJSON(): unknown }> };
            };
            return {
                title: browserGlobal.document.title,
                readyState: browserGlobal.document.readyState,
                navigation: browserGlobal.performance.getEntriesByType("navigation")[0]?.toJSON(),
            };
        }),
        requests: entries,
        totals: {
            requestCount: entries.length,
            failedCount: entries.filter((entry) => entry.failure).length,
            responseBytes: entries.reduce((total, entry) => total + entry.responseBodyBytes, 0),
            byResourceType: countResourceTypes(entries),
        },
    };
    const reportPath = resolve(
        projectRoot,
        ".data/performance",
        `web-waterfall-${new Date().toISOString().replaceAll(/[:.]/g, "-")}.json`
    );
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    process.stdout.write(
        `${JSON.stringify({ result: report.result, reportPath, totals: report.totals, navigationMs: report.navigationMs })}\n`
    );
} finally {
    await page.close();
    await browser.close();
    await closeServer(server);
}

async function captureFinishedRequest(request: Request) {
    const record = records.get(request);
    if (!record) return;

    const timing = request.timing();
    const sizes = await request.sizes();
    const response = await request.response();
    record.entry.status = response?.status();
    record.entry.requestStartMs = timing.requestStart;
    record.entry.responseStartMs = timing.responseStart >= 0 ? timing.responseStart : undefined;
    record.entry.responseEndMs = timing.responseEnd >= 0 ? timing.responseEnd : undefined;
    record.entry.durationMs = timing.responseEnd >= 0 ? timing.responseEnd - timing.requestStart : undefined;
    record.entry.requestBodyBytes = sizes.requestBodySize;
    record.entry.responseBodyBytes = sizes.responseBodySize;
}

function normalizeEntries(entries: WaterfallEntry[]) {
    const firstRequest = Math.min(...entries.map((entry) => entry.requestStartMs).filter((value) => value >= 0));
    return entries
        .map((entry) => ({
            ...entry,
            requestStartMs: round(entry.requestStartMs - firstRequest),
            ...(entry.responseStartMs !== undefined
                ? { responseStartMs: round(entry.responseStartMs - firstRequest) }
                : {}),
            ...(entry.responseEndMs !== undefined ? { responseEndMs: round(entry.responseEndMs - firstRequest) } : {}),
            ...(entry.durationMs !== undefined ? { durationMs: round(entry.durationMs) } : {}),
        }))
        .sort((left, right) => left.requestStartMs - right.requestStartMs || left.url.localeCompare(right.url));
}

function countResourceTypes(entries: WaterfallEntry[]) {
    return entries.reduce<Record<string, number>>((counts, entry) => {
        counts[entry.resourceType] = (counts[entry.resourceType] ?? 0) + 1;
        return counts;
    }, {});
}

async function serveRequest(request: IncomingMessage, response: ServerResponse) {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    if (requestUrl.pathname.startsWith("/api/")) {
        sendJson(response, apiResponse(requestUrl.pathname));
        return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405, { Allow: "GET, HEAD" }).end();
        return;
    }

    let filePath = resolve(staticRoot, `.${decodeURIComponent(requestUrl.pathname)}`);
    if (!extname(filePath) || requestUrl.pathname.endsWith("/")) filePath = resolve(staticRoot, "index.html");
    const relativePath = relative(staticRoot, filePath);
    if (!relativePath || relativePath === ".." || relativePath.startsWith("..\\") || isAbsolute(relativePath)) {
        response.writeHead(404).end();
        return;
    }

    const body = await readFile(filePath);
    response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Length": String(body.byteLength),
        "Content-Type": mimeTypes[extname(filePath).toLowerCase()] ?? "application/octet-stream",
    });
    if (request.method === "HEAD") response.end();
    else response.end(body);
}

function apiResponse(pathname: string) {
    const generatedAt = Date.now();
    if (pathname.endsWith("/v1/sources")) {
        return {
            data: {
                sources: [
                    { id: "zhihu", name: "知乎", interval: 600_000, color: "slate", type: "normal", disabled: false },
                ],
                columns: [],
            },
            meta: { generatedAt, sourceCount: 1, redirectCount: 0, disabledCount: 0, columnCount: 0 },
            errors: [],
        };
    }
    if (pathname.endsWith("/v1/health/sources")) {
        return {
            updatedAt: generatedAt,
            total: 1,
            healthy: 1,
            failing: 0,
            idle: 0,
            cacheDegraded: 0,
            sources: [{ id: "zhihu", name: "知乎", status: "healthy", successCount: 1, errorCount: 0 }],
        };
    }
    if (pathname.endsWith("/v1/health/deployment")) return { data: { status: "ready" }, errors: [] };
    if (pathname.endsWith("/v1/sources/batch") || pathname.endsWith("/s/entire")) {
        return {
            data: [
                {
                    status: "success",
                    id: "zhihu",
                    name: "知乎",
                    updatedTime: generatedAt,
                    items: [fixtureItem],
                },
            ],
            meta: {
                generatedAt,
                requestedSourceCount: 1,
                resolvedSourceCount: 1,
                partial: false,
                omittedSourceIds: [],
                itemCount: 1,
                unfilteredItemCount: 1,
            },
            errors: [],
        };
    }
    if (pathname.endsWith("/me")) return { status: "unauthenticated", data: null };
    return { data: [], errors: [] };
}

function sendJson(response: ServerResponse, payload: unknown) {
    const body = JSON.stringify(payload);
    response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Length": String(Buffer.byteLength(body)),
        "Content-Type": "application/json; charset=utf-8",
    });
    response.end(body);
}

function listen(target: ReturnType<typeof createServer>) {
    return new Promise<void>((resolveListen, reject) => {
        target.once("error", reject);
        target.listen(0, "127.0.0.1", () => resolveListen());
    });
}

function closeServer(target: ReturnType<typeof createServer>) {
    return new Promise<void>((resolveClosed, reject) => {
        target.close((error) => (error ? reject(error) : resolveClosed()));
        target.closeAllConnections();
    });
}

function readGitState() {
    const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: projectRoot, encoding: "utf8" }).trim();
    const status = execFileSync("git", ["status", "--porcelain"], { cwd: projectRoot, encoding: "utf8" });
    return { commit, workingTreeDirty: status.trim().length > 0 };
}

function round(value: number) {
    return Math.round(value * 1000) / 1000;
}
