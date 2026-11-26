import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { performance } from "node:perf_hooks";
import { extname, resolve, relative } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { createNewsInsights } from "../../shared/news-insights";

const roots = process.argv.slice(2);
if (!roots.length) roots.push("dist");
const rounds = 3;
const catalogDelayMs = 300;
const insightsDelayMs = 1200;
const headline = "Reload cache performance fixture";
const mime: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".woff2": "font/woff2",
    ".webmanifest": "application/manifest+json",
};

async function measure(root: string) {
    const calls = { catalog: 0, insights: 0 };
    const server = createServer((req, res) => {
        void (async () => {
            const path = new URL(req.url ?? "/", "http://localhost").pathname;
            if (path.startsWith("/api/")) {
                const now = Date.now();
                let result: unknown = { data: [], errors: [] };
                if (path.endsWith("/v1/sources")) {
                    calls.catalog++;
                    await delay(catalogDelayMs);
                    result = {
                        data: { sources: [], columns: [] },
                        meta: { generatedAt: now, sourceCount: 0, redirectCount: 0, disabledCount: 0, columnCount: 0 },
                    };
                } else if (path.endsWith("/v1/insights")) {
                    calls.insights++;
                    await delay(insightsDelayMs);
                    result = {
                        data: createNewsInsights(
                            [
                                {
                                    id: "hackernews",
                                    name: "Hacker News",
                                    status: "success",
                                    updatedTime: now,
                                    items: [
                                        {
                                            id: "reload-fixture",
                                            title: headline,
                                            url: "https://example.test/reload-fixture",
                                            pubDate: now,
                                        },
                                    ],
                                },
                            ],
                            { generatedAt: now }
                        ),
                        meta: {
                            generatedAt: now,
                            requestedSourceCount: 1,
                            resolvedSourceCount: 1,
                            partial: false,
                            omittedSourceIds: [],
                        },
                        errors: [],
                    };
                } else if (path.endsWith("/v1/health/sources")) {
                    result = {
                        data: [],
                        meta: {
                            generatedAt: now,
                            totalSourceCount: 0,
                            healthyCount: 0,
                            failingCount: 0,
                            idleCount: 0,
                            cacheDegradedCount: 0,
                        },
                        errors: [],
                    };
                } else if (path.endsWith("/me")) result = { status: "unauthenticated", data: null };
                res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(
                    JSON.stringify(result)
                );
                return;
            }
            const file = resolve(root, extname(path) ? "." + decodeURIComponent(path) : "index.html");
            if (relative(root, file).startsWith("..")) {
                res.writeHead(404).end();
                return;
            }
            const bytes = await readFile(file);
            res.writeHead(200, {
                "Content-Type": mime[extname(file)] ?? "application/octet-stream",
                "Cache-Control": "no-store",
            }).end(bytes);
        })().catch(() => {
            if (!res.headersSent) res.writeHead(500);
            res.end();
        });
    });
    await new Promise<void>((done, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", done);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Fixture failed to bind");
    const origin = "http://127.0.0.1:" + address.port;
    const browser = await chromium.launch({ headless: true });
    try {
        const samples = [];
        for (let i = 0; i < rounds; i++) {
            const context = await browser.newContext({
                serviceWorkers: "block",
                viewport: { width: 1280, height: 800 },
            });
            // No production network: only local synthetic HTTP fixture.
            await context.route("**/*", (route) =>
                new URL(route.request().url()).origin === origin ? route.continue() : route.abort()
            );
            const page = await context.newPage();
            try {
                async function sample(navigate: () => Promise<unknown>) {
                    const before = { ...calls };
                    const start = performance.now();
                    await navigate();
                    await page
                        .getByRole("link", { name: headline, exact: true })
                        .waitFor({ state: "visible", timeout: 30000 });
                    const visibleMs = performance.now() - start;
                    // Count any requests that started immediately after render.
                    await delay(250);
                    return {
                        visibleMs: Math.round(visibleMs * 10) / 10,
                        catalogRequests: calls.catalog - before.catalog,
                        insightsRequests: calls.insights - before.insights,
                    };
                }
                const cold = await sample(() => page.goto(origin + "/insights", { waitUntil: "domcontentloaded" }));
                const reload = await sample(() => page.reload({ waitUntil: "domcontentloaded" }));
                samples.push({ round: i + 1, cold, reload });
            } finally {
                await context.close();
            }
        }
        return { root, samples };
    } finally {
        await browser.close();
        await new Promise<void>((done) => {
            server.close(() => done());
            server.closeAllConnections();
        });
    }
}

const results = [];
for (const root of roots) results.push(await measure(resolve(root)));
console.log(
    JSON.stringify({
        catalogDelayMs,
        insightsDelayMs,
        rounds,
        assetCache: "no-store",
        serviceWorker: "blocked",
        results,
    })
);
