import { createApp } from "h3";
import { createDatabase } from "db0";
import sqliteConnector from "db0/connectors/better-sqlite3";
import { it, vi, expect, describe, afterAll, afterEach, beforeEach } from "vitest";

import cacheAuth from "./middleware/auth";
import { getCacheTable } from "./database/cache";
import refreshHandler from "./api/v1/sources/refresh.post";
import { CrawlerPlatformError } from "../crawler-platform/core/errors";
import { clearRuntimeSourceCatalog, registerRuntimeSourceCatalog } from "../shared/runtime-source-catalog";

const { getDatabase, fetchSourceItems, hasSourceGetter } = vi.hoisted(() => ({
    getDatabase: vi.fn(),
    fetchSourceItems: vi.fn(),
    hasSourceGetter: vi.fn(),
}));
vi.mock("nitro/database", () => ({ useDatabase: getDatabase }));
vi.mock("#/utils/source-fetch", () => ({ fetchSourceItems, hasSourceGetter }));

const path = "/api/v1/sources/refresh";
const testToken = "test-token-for-source-refresh-only";
const previousItem = { id: "previous", title: "Previous", url: "https://example.test/previous" };
const currentItem = { id: "current", title: "Current", url: "https://example.test/current" };
const app = createApp();
app.use(cacheAuth);
app.post(path, refreshHandler);

describe("scheduled source refresh", () => {
    // The cache module keeps a single database connector for the server process.
    const database = createDatabase(sqliteConnector({ name: ":memory:" }));

    beforeEach(() => {
        getDatabase.mockReturnValue(database);
        vi.stubEnv("LATESTNEWS_REFRESH_TOKEN", testToken);
        vi.stubEnv("JWT_SECRET", undefined);
        vi.stubEnv("ENABLE_CACHE", "true");
        vi.stubEnv("INIT_TABLE", "true");
    });

    afterEach(() => {
        clearRuntimeSourceCatalog();
        vi.unstubAllEnvs();
        vi.resetAllMocks();
    });

    afterAll(() => database.dispose());

    it("requires a configured token and validates query parameters before touching storage", async () => {
        expect((await app.request(path, { method: "POST" })).status).toBe(401);
        expect((await request(path, "incorrect-token-for-this-endpoint")).status).toBe(401);
        expect((await request(`${path}?cursor=a&cursor=b`)).status).toBe(400);
        expect((await request(`${path}?force=1`)).status).toBe(400);
        expect((await request(`${path}?force=true&force=false`)).status).toBe(400);
        vi.stubEnv("LATESTNEWS_REFRESH_TOKEN", "");
        expect((await request(path)).status).toBe(503);
        expect(getDatabase).not.toHaveBeenCalled();
        expect(fetchSourceItems).not.toHaveBeenCalled();
    });

    it("returns 503 without advancing the cursor when collection is interrupted", async () => {
        hasSourceGetter.mockImplementation((id) => id === "hackernews");
        fetchSourceItems.mockRejectedValueOnce(new CrawlerPlatformError("CANCELLED", "Collection has stopped."));
        fetchSourceItems.mockResolvedValueOnce([currentItem]);
        const url = `${path}?cursor=hackernewr&force=true`;

        try {
            const cache = (await getCacheTable())!;
            await cache.set("hackernews", [previousItem]);

            const interrupted = await request(url);
            expect(interrupted.status).toBe(503);
            expect(await interrupted.json()).not.toHaveProperty("meta.nextCursor");
            expect(await cache.get("hackernews")).toMatchObject({ items: [previousItem] });

            const retry = await request(url);
            expect(retry.status).toBe(200);
            expect(await retry.json()).toMatchObject({
                data: { sources: [{ id: "hackernews", status: "refreshed", itemCount: 1 }] },
                meta: { nextCursor: null },
            });
            expect(await cache.get("hackernews")).toMatchObject({ items: [currentItem] });
        } finally {
            await cacheCleanup();
        }
    });

    it("scans enabled canonical sources, persists new data and keeps older items on empty or failed collection", async () => {
        hasSourceGetter.mockImplementation((id) =>
            ["github-trending-today", "hackernews", "ithome", "juejin", "v2ex", "bilibili-hot-video"].includes(id)
        );
        fetchSourceItems.mockImplementation(async (id) => {
            if (id === "ithome") throw new Error("Upstream unavailable");
            return id === "hackernews" ? [currentItem] : [];
        });

        try {
            const cache = (await getCacheTable())!;
            for (const id of ["hackernews", "ithome", "juejin"] as const) {
                await cache.set(id, [previousItem]);
            }
            await database.prepare("UPDATE cache SET updated = 0").run();
            await cache.set("github-trending-today", [previousItem]);

            const firstResponse = await request(path);
            expect(firstResponse.status).toBe(200);
            expect(firstResponse.headers.get("cache-control")).toBe("no-store");
            expect(await firstResponse.json()).toMatchObject({
                data: {
                    sources: [
                        { id: "github-trending-today", status: "fresh" },
                        { id: "hackernews", status: "refreshed", itemCount: 1 },
                        { id: "ithome", status: "failed" },
                    ],
                },
                meta: { totalSources: 4, nextCursor: "ithome" },
                errors: [{ sourceId: "ithome" }],
            });

            const finalResponse = await request(`${path}?cursor=ithome`);
            expect(finalResponse.status).toBe(200);
            expect(await finalResponse.json()).toMatchObject({
                data: { sources: [{ id: "juejin", status: "empty" }] },
                meta: { totalSources: 4, nextCursor: null },
                errors: [],
            });
            expect(fetchSourceItems.mock.calls.map(([id]) => id)).toEqual(["hackernews", "ithome", "juejin"]);
            expect(await cache.get("hackernews")).toMatchObject({ items: [currentItem] });
            expect(await cache.get("ithome")).toMatchObject({ updated: 0, items: [previousItem] });
            expect(await cache.get("juejin")).toMatchObject({ updated: 0, items: [previousItem] });

            registerRuntimeSourceCatalog([
                {
                    id: "ext.config.scheduled",
                    name: "Configured source",
                    interval: 300_000,
                    color: "primary",
                    type: "normal",
                    disabled: false,
                },
            ]);
            hasSourceGetter.mockImplementation((id) =>
                ["ext.config.scheduled", "github-trending-today", "hackernews", "ithome", "juejin"].includes(id)
            );
            fetchSourceItems.mockResolvedValue([currentItem]);
            fetchSourceItems.mockClear();
            await cache.set("ext.config.scheduled", [previousItem]);

            const forcedResponse = await request(`${path}?force=true`);
            expect(forcedResponse.status).toBe(200);
            expect(await forcedResponse.json()).toMatchObject({
                data: {
                    sources: [
                        { id: "ext.config.scheduled", status: "refreshed", itemCount: 1 },
                        { id: "github-trending-today", status: "refreshed", itemCount: 1 },
                        { id: "hackernews", status: "refreshed", itemCount: 1 },
                    ],
                },
                meta: { totalSources: 5, nextCursor: "hackernews" },
                errors: [],
            });
            expect(fetchSourceItems.mock.calls.map(([id]) => id)).toEqual([
                "ext.config.scheduled",
                "github-trending-today",
                "hackernews",
            ]);
            expect(await cache.get("ext.config.scheduled")).toMatchObject({ items: [currentItem] });

            const forcedFinalResponse = await request(`${path}?force=true&cursor=hackernews`);
            expect(forcedFinalResponse.status).toBe(200);
            expect(await forcedFinalResponse.json()).toMatchObject({
                data: {
                    sources: [
                        { id: "ithome", status: "refreshed", itemCount: 1 },
                        { id: "juejin", status: "refreshed", itemCount: 1 },
                    ],
                },
                meta: { totalSources: 5, nextCursor: null },
                errors: [],
            });
        } finally {
            await cacheCleanup();
        }
    });

    async function cacheCleanup() {
        await database.prepare("DELETE FROM cache").run();
    }
});

function request(url: string, token = testToken) {
    return app.request(url, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
}
