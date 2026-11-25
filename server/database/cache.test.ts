import type { Database } from "db0";

import { createDatabase } from "db0";
import sqliteConnector from "db0/connectors/better-sqlite3";
import { it, vi, expect, describe, afterEach } from "vitest";

const { getRuntimeDatabase } = vi.hoisted(() => ({ getRuntimeDatabase: vi.fn() }));
vi.mock("nitro/database", () => ({ useDatabase: getRuntimeDatabase }));

afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    getRuntimeDatabase.mockReset();
});

describe("cache database availability", () => {
    it("returns no cache table when the configured database binding is unavailable", async () => {
        vi.stubEnv("ENABLE_CACHE", "true");
        vi.stubEnv("INIT_TABLE", "false");
        getRuntimeDatabase.mockReturnValue({
            prepare: () => ({
                get: () => Promise.reject(new Error("[db0] [d1] binding `LATESTNEWS_DB` not found")),
            }),
        } as unknown as Database);

        const { logger } = await import("../utils/logger");
        vi.spyOn(logger, "error").mockImplementation(() => undefined);

        const { getCacheTable } = await import("./cache");

        await expect(getCacheTable()).resolves.toBeUndefined();
    });

    it("returns the cache table after a successful availability check", async () => {
        vi.stubEnv("ENABLE_CACHE", "true");
        vi.stubEnv("INIT_TABLE", "false");
        const get = vi.fn().mockResolvedValue({ id: "probe" });
        getRuntimeDatabase.mockReturnValue({
            prepare: () => ({ get }),
        } as unknown as Database);

        const { getCacheTable } = await import("./cache");
        const cacheTable = await getCacheTable();

        expect(cacheTable).toBeDefined();
        expect(get).toHaveBeenCalledOnce();
    });

    it("persists and reads news through the imported database provider", async () => {
        vi.stubEnv("ENABLE_CACHE", "true");
        vi.stubEnv("INIT_TABLE", "true");
        const database = createDatabase(sqliteConnector({ name: ":memory:" }));
        getRuntimeDatabase.mockReturnValue(database);
        try {
            const { getCacheTable } = await import("./cache");
            const table = await getCacheTable();
            expect(table).toBeDefined();
            const items = [{ id: "article-1", title: "News", url: "https://example.com/news/1" }];
            await table!.set("juejin", items);
            expect(await table!.get("juejin")).toMatchObject({ id: "juejin", items });
            await expect(table!.searchArticles({ query: "News" })).resolves.toMatchObject({
                status: "ok",
                items: [expect.objectContaining({ title: "News", sourceIds: ["juejin"] })],
            });
            expect(getRuntimeDatabase).toHaveBeenCalledOnce();
        } finally {
            await database.dispose();
        }
    });
    it("filters unsafe cached and indexed links without rewriting legacy data on read", async () => {
        const database = createDatabase(sqliteConnector({ name: ":memory:" }));
        try {
            const { Cache } = await import("./cache");
            const cache = new Cache(database);
            await cache.init();
            const valid = { id: "safe", title: "Boundary fixture", url: "https://example.test/safe" };
            const bad = { id: "bad", title: "Boundary fixture", url: "file:///legacy" };
            const legacy = JSON.stringify([bad, { ...valid, mobileUrl: bad.url }]);
            await database.prepare("INSERT INTO cache (id, data, updated) VALUES (?, ?, ?)").run("weibo", legacy, 1);
            expect((await cache.get("weibo"))?.items).toEqual([valid]);
            expect((await cache.getEntire(["weibo"]))[0].items).toEqual([valid]);
            expect(await database.prepare("SELECT data FROM cache WHERE id = ?").get("weibo")).toEqual({
                data: legacy,
            });
            await expect(cache.set("weibo", [bad])).rejects.toThrow("no valid article URLs");
            expect(await database.prepare("SELECT data FROM cache WHERE id = ?").get("weibo")).toEqual({
                data: legacy,
            });
            await cache.set("weibo", [bad, { ...valid, mobileUrl: bad.url }]);
            expect((await cache.get("weibo"))?.items).toEqual([valid]);
            expect((await cache.searchArticles({ query: "Boundary" })).items.map((item) => item.item)).toEqual([valid]);
        } finally {
            await database.dispose();
        }
    });
});
