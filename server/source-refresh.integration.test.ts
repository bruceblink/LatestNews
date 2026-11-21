import { createApp } from "h3";
import { createDatabase } from "db0";
import sqliteConnector from "db0/connectors/better-sqlite3";
import { it, vi, expect, describe, afterEach, beforeEach } from "vitest";

import cacheAuth from "./middleware/auth";
import { getCacheTable } from "./database/cache";
import refreshHandler from "./api/v1/sources/refresh.post";

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
    beforeEach(() => {
        vi.stubEnv("LATESTNEWS_REFRESH_TOKEN", testToken);
        vi.stubEnv("JWT_SECRET", undefined);
        vi.stubEnv("ENABLE_CACHE", "true");
        vi.stubEnv("INIT_TABLE", "true");
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.resetAllMocks();
    });

    it("requires a configured token and validates the cursor before touching storage", async () => {
        expect((await app.request(path, { method: "POST" })).status).toBe(401);
        expect((await request(path, "incorrect-token-for-this-endpoint")).status).toBe(401);
        expect((await request(`${path}?cursor=a&cursor=b`)).status).toBe(400);
        vi.stubEnv("LATESTNEWS_REFRESH_TOKEN", "");
        expect((await request(path)).status).toBe(503);
        expect(getDatabase).not.toHaveBeenCalled();
        expect(fetchSourceItems).not.toHaveBeenCalled();
    });

    it("scans enabled canonical sources, persists new data and keeps older items on empty or failed collection", async () => {
        const database = createDatabase(sqliteConnector({ name: ":memory:" }));
        getDatabase.mockReturnValue(database);
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
            expect(fetchSourceItems.mock.calls.flat()).toEqual(["hackernews", "ithome", "juejin"]);
            expect(await cache.get("hackernews")).toMatchObject({ items: [currentItem] });
            expect(await cache.get("ithome")).toMatchObject({ updated: 0, items: [previousItem] });
            expect(await cache.get("juejin")).toMatchObject({ updated: 0, items: [previousItem] });
        } finally {
            await database.dispose();
        }
    });
});

function request(url: string, token = testToken) {
    return app.request(url, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
}
