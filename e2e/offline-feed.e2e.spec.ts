import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";
import { sep, extname, resolve } from "node:path";

test("restores a fresh Feed snapshot after an offline reload", async ({ page }) => {
    test.skip(!process.env.LATESTNEWS_PWA_TEST_ROOT, "Requires a prepared production build.");
    const root = resolve(process.env.LATESTNEWS_PWA_TEST_ROOT ?? fileURLToPath(new URL("../dist/", import.meta.url)));
    const fixtureTitle = "Offline fixture headline";
    let apiEnabled = true;
    const mime: Record<string, string> = {
        ".html": "text/html",
        ".js": "application/javascript",
        ".css": "text/css",
        ".json": "application/json",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".webmanifest": "application/manifest+json",
        ".woff2": "font/woff2",
        ".ttf": "font/ttf",
    };
    const server = createServer(async (request, response) => {
        const path = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
        if (path.startsWith("/api/")) {
            if (!apiEnabled) {
                response.writeHead(503).end();
                return;
            }
            response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
            response.end(
                JSON.stringify({
                    data: [
                        {
                            status: "success",
                            id: "zhihu",
                            name: "知乎",
                            updatedTime: Date.now(),
                            items: [
                                {
                                    id: "offline-fixture-1",
                                    title: fixtureTitle,
                                    url: "https://example.test/offline-fixture-1",
                                    pubDate: Date.now(),
                                },
                            ],
                        },
                    ],
                    meta: {
                        generatedAt: Date.now(),
                        requestedSourceCount: 1,
                        resolvedSourceCount: 1,
                        partial: false,
                        omittedSourceIds: [],
                        itemCount: 1,
                        unfilteredItemCount: 1,
                        filters: { sourceIds: ["zhihu"], columns: [], types: [] },
                    },
                    errors: [],
                })
            );
            return;
        }

        let file = resolve(root, `.${path}`);
        if (!file.startsWith(`${root.replace(/[\\/]$/, "")}${sep}`) || !extname(path) || path.endsWith("/")) {
            file = resolve(root, "index.html");
        }
        try {
            const content = await readFile(file);
            response.writeHead(200, {
                "Content-Type": mime[extname(file)] ?? "application/octet-stream",
                "Cache-Control": "no-store",
            });
            response.end(content);
        } catch {
            response.writeHead(404).end();
        }
    });
    await new Promise<void>((resolveReady, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolveReady);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind a port.");

    try {
        await page.goto(`http://127.0.0.1:${address.port}/feed?scope=hottest&since=all`);
        await expect(page.getByText(fixtureTitle, { exact: true })).toBeVisible();
        await page.evaluate(async () => navigator.serviceWorker.ready);
        if (!(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))) {
            await page.reload();
        }
        await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

        apiEnabled = false;
        await page.context().setOffline(true);
        await page.reload({ waitUntil: "domcontentloaded" });
        await expect(page.getByText(fixtureTitle, { exact: true })).toBeVisible();
        await expect(page.getByText(/当前展示.*Feed 快照/)).toBeVisible();

        await page.context().setOffline(false);
        await page.evaluate(() => {
            const storageKey = "latestnews:offline-feed-snapshots";
            const raw = localStorage.getItem(storageKey);
            if (!raw) throw new Error("Feed snapshot was not persisted.");
            const store = JSON.parse(raw) as { version: number; snapshots: Array<Record<string, unknown>> };
            store.snapshots = store.snapshots.map((snapshot) => ({
                ...snapshot,
                savedAt: Date.now() - 8 * 24 * 60 * 60 * 1000,
            }));
            localStorage.setItem(storageKey, JSON.stringify(store));
        });
        await page.context().setOffline(true);
        await page.reload({ waitUntil: "domcontentloaded" });
        await expect(page.getByText(fixtureTitle, { exact: true })).toHaveCount(0);
        await expect(page.getByText(/已保存的 Feed 快照.*已过期/)).toBeVisible();
    } finally {
        await page.context().setOffline(false);
        await new Promise<void>((resolveClosed) => {
            server.close(() => resolveClosed());
            server.closeAllConnections();
        });
    }
});
