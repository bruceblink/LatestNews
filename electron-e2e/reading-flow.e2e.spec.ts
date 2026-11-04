import type { Page, ElectronApplication } from "@playwright/test";

import { tmpdir } from "node:os";
import { join } from "node:path";
import { rm, mkdtemp } from "node:fs/promises";
import { test, expect, _electron } from "@playwright/test";
import { createServer, type ServerResponse } from "node:http";

const fixtureItem = {
    id: "electron-fixture-1",
    title: "Electron fixture headline",
    url: "https://example.test/electron-fixture-1",
    pubDate: "2026-11-04T00:00:00.000Z",
};

let electronApp: ElectronApplication;
let page: Page;
let userDataDirectory: string;
let apiServer: ReturnType<typeof createServer>;
let apiOrigin: string;

test.beforeAll(async () => {
    apiServer = createServer((request, response) => {
        const pathname = new URL(request.url ?? "/", "http://localhost").pathname.replace(/^\/api(?=\/|$)/, "");
        if (pathname === "/s/health" || pathname === "/v1/health/sources") {
            sendJson(response, {
                updatedAt: Date.now(),
                total: 1,
                healthy: 1,
                failing: 0,
                idle: 0,
                cacheDegraded: 0,
                sources: [
                    {
                        id: "hackernews",
                        name: "Hacker News",
                        status: "healthy",
                        successCount: 1,
                        errorCount: 0,
                        consecutiveFailures: 0,
                        cacheDegraded: false,
                        lastDurationMs: 12,
                        lastSuccessAt: Date.now(),
                        lastItemCount: 1,
                        recentEvents: [],
                    },
                ],
            });
            return;
        }

        if (pathname === "/v1/sources") {
            sendJson(response, {
                data: {
                    sources: [
                        {
                            id: "hackernews",
                            name: "Hacker News",
                            interval: 600_000,
                            color: "slate",
                            type: "normal",
                            disabled: false,
                        },
                    ],
                    columns: [],
                },
                meta: {
                    generatedAt: Date.now(),
                    sourceCount: 1,
                    redirectCount: 0,
                    disabledCount: 0,
                    columnCount: 0,
                },
            });
            return;
        }

        if (pathname === "/v1/sources/hackernews") {
            sendJson(response, {
                data: {
                    id: "hackernews",
                    name: "Hacker News",
                    interval: 600_000,
                    color: "slate",
                    type: "normal",
                    disabled: false,
                    home: "https://news.ycombinator.com/",
                },
                meta: {
                    generatedAt: Date.now(),
                    sourceId: "hackernews",
                    canonicalSourceId: "hackernews",
                    redirected: false,
                },
                errors: [],
            });
            return;
        }

        if (pathname === "/v1/sources/hackernews/items") {
            sendJson(response, {
                data: {
                    status: "success",
                    id: "hackernews",
                    name: "Hacker News",
                    updatedTime: Date.now(),
                    items: [fixtureItem],
                },
                meta: {
                    generatedAt: Date.now(),
                    sourceId: "hackernews",
                    status: "success",
                    itemCount: 1,
                    unfilteredItemCount: 1,
                },
                errors: [],
            });
            return;
        }

        sendJson(response, { data: [], errors: [] });
    });
    const port = await listen(apiServer);
    apiOrigin = `http://127.0.0.1:${port}`;

    userDataDirectory = await mkdtemp(join(tmpdir(), "latestnews-playwright-electron-reading-"));
    await launchElectronApp();
    await page.goto("app://bundle/settings");
    await page.getByLabel("数据源 API URL").fill(apiOrigin);
    await page.getByRole("button", { name: "保存并刷新" }).click();
    await expect
        .poll(async () => (await page.evaluate(() => window.latestNewsDesktop?.getNewsApiUrl?.()))?.url)
        .toBe(apiOrigin);
});

test("keeps reading history and saved states across Electron source and history routes", async () => {
    await page.addInitScript(() => {
        const callsKey = "__latestNewsServiceWorkerRegisterCalls";
        (window as unknown as Record<string, unknown>)[callsKey] = 0;
        const serviceWorker = navigator.serviceWorker;
        if (!serviceWorker) return;
        const prototype = Object.getPrototypeOf(serviceWorker) as {
            register?: (...args: unknown[]) => Promise<unknown>;
        };
        const register = prototype.register;
        if (typeof register !== "function") return;
        Object.defineProperty(prototype, "register", {
            configurable: true,
            value(...args: unknown[]) {
                const current = Number((window as unknown as Record<string, unknown>)[callsKey] ?? 0);
                (window as unknown as Record<string, unknown>)[callsKey] = current + 1;
                return register.apply(this, args);
            },
        });
    });
    await page.reload();
    expect(
        await page.evaluate(() =>
            Number((window as unknown as Record<string, unknown>).__latestNewsServiceWorkerRegisterCalls)
        )
    ).toBe(0);
    await page.goto("app://bundle/source/hackernews");
    await expect(page.getByRole("heading", { name: "Hacker News", level: 1 })).toBeVisible();
    const itemLink = page.getByRole("link", { name: new RegExp(fixtureItem.title) });
    await expect(itemLink).toBeVisible();

    await page.getByRole("button", { name: "稍后读", exact: true }).click();
    await page.getByRole("button", { name: "收藏", exact: true }).click();
    await expect(page.getByRole("button", { name: "移出稍后读", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "取消收藏", exact: true })).toBeVisible();

    await itemLink.click();
    await expect(itemLink).toContainText("已读");

    await page.goto("app://bundle/history");
    await expect(page.getByRole("heading", { name: "阅读历史", level: 1 })).toBeVisible();
    await expect(page.getByText(fixtureItem.title, { exact: true })).toBeVisible();
    const historyTabs = page.locator(".history-tabs");
    await historyTabs.getByRole("button", { name: /稍后读/ }).click();
    await expect(page.getByText(fixtureItem.title, { exact: true })).toBeVisible();
    await historyTabs.getByRole("button", { name: /收藏/ }).click();
    await expect(page.getByText(fixtureItem.title, { exact: true })).toBeVisible();

    await page.reload();
    await expect(page.getByText(fixtureItem.title, { exact: true })).toBeVisible();

    await closeElectronApp();
    await launchElectronApp();
    await page.goto("app://bundle/history");
    await expect(page.getByText(fixtureItem.title, { exact: true })).toBeVisible();
});

test.afterAll(async () => {
    try {
        await closeElectronApp();
    } finally {
        await closeApiServer();
        if (userDataDirectory)
            await rm(userDataDirectory, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
    }
});

function sendJson(response: ServerResponse, body: unknown) {
    response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    response.end(JSON.stringify(body));
}

function listen(server: ReturnType<typeof createServer>) {
    return new Promise<number>((resolvePort, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            if (!address || typeof address === "string") {
                reject(new Error("Electron reading-flow API server did not bind a port."));
                return;
            }
            resolvePort(address.port);
        });
    });
}

async function launchElectronApp() {
    const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: "true" };
    delete env.LATESTNEWS_CRAWLER_PLUGIN_DIR;
    electronApp = await _electron.launch({
        args: [
            "--no-sandbox",
            `--user-data-dir=${userDataDirectory}`,
            ...(process.env.LATESTNEWS_ELECTRON_PACKAGED_TEST === "1" ? [] : ["."]),
        ],
        env,
        executablePath: process.env.LATESTNEWS_ELECTRON_EXECUTABLE,
        timeout: 60_000,
    });
    page = await electronApp.firstWindow();
    await page.waitForLoadState("load");
}

async function closeElectronApp() {
    if (!electronApp) return;
    let electronProcess;
    try {
        electronProcess = electronApp.process();
    } catch {
        return;
    }
    const closeEvent = new Promise<void>((resolveClosed) => electronApp.once("close", resolveClosed));
    await electronApp.evaluate(({ app }) => app.quit()).catch(() => undefined);
    const closedGracefully = await Promise.race([
        closeEvent.then(() => true),
        new Promise<boolean>((resolveClosed) => setTimeout(() => resolveClosed(false), 5000)),
    ]);
    if (!closedGracefully) {
        // Xvfb can leave app.quit waiting on a hidden window; force the test process to finish cleanup.
        await electronApp.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
    }
    if (electronProcess.exitCode === null) {
        if (process.platform === "win32") {
            electronProcess.kill();
        } else if (electronProcess.pid) {
            try {
                process.kill(-electronProcess.pid, "SIGKILL");
            } catch {
                electronProcess.kill("SIGKILL");
            }
        }
    }
    // Playwright removes the process from its graceful-close set only after all stdio pipes close.
    electronProcess.stdout?.destroy();
    electronProcess.stderr?.destroy();
    for (const stream of electronProcess.stdio.slice(3)) stream?.destroy();
    await Promise.race([closeEvent, new Promise<void>((resolveClosed) => setTimeout(resolveClosed, 1000))]);
}

async function closeApiServer() {
    if (!apiServer) return;
    apiServer.closeAllConnections();
    await Promise.race([
        new Promise<void>((resolveClosed) => apiServer.close(() => resolveClosed())),
        new Promise<void>((resolveClosed) => setTimeout(resolveClosed, 1000)),
    ]);
}
