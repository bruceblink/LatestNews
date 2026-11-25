import type { H3Event } from "h3";
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
        expect(get).toHaveBeenCalledTimes(2);
    });

    it("does not share a Pages initialization promise or binding across requests", async () => {
        const { Cache, getCacheTable } = await import("./cache");
        const firstBinding = { prepare: vi.fn(), batch: vi.fn(), exec: vi.fn() };
        const secondBinding = { prepare: vi.fn(), batch: vi.fn(), exec: vi.fn() };
        let unblock!: () => void;
        const blocked = new Promise<void>((resolve) => {
            unblock = resolve;
        });
        const spy = vi
            .spyOn(Cache.prototype, "openPages")
            .mockImplementationOnce(() => blocked)
            .mockResolvedValueOnce(undefined);
        const event = (binding: unknown) =>
            ({
                req: { runtime: { cloudflare: { env: { LATESTNEWS_DB: binding } } } },
                waitUntil: vi.fn(),
            }) as unknown as H3Event;
        const first = getCacheTable(event(firstBinding));
        try {
            const second = await getCacheTable(event(secondBinding));
            expect(second).toBeDefined();
            expect(spy).toHaveBeenCalledTimes(2);
            expect(getRuntimeDatabase).not.toHaveBeenCalled();
            unblock();
            expect(await first).not.toBe(second);
        } finally {
            unblock();
            await first;
        }
        const { createRequestD1Database } = await import("./request-d1");
        const a = createRequestD1Database(firstBinding),
            b = createRequestD1Database(secondBinding);
        expect(await a.getInstance()).toBe(firstBinding);
        expect(await b.getInstance()).toBe(secondBinding);
    });

    it("opens an initialized Pages cache without replaying legacy snapshots or waiting for deferred writes", async () => {
        const database = createDatabase(sqliteConnector({ name: ":memory:" }));
        try {
            const { Cache } = await import("./cache");
            const initial = new Cache(database);
            await initial.init();
            const old = { id: "old", title: "Old backlog fixture", url: "https://example.test/old" };
            await database.prepare("INSERT INTO cache VALUES(?,?,?)").run("weibo", 1, JSON.stringify([old]));
            await database
                .prepare("INSERT INTO article_ingest_pending(id,source_id,payload,observed_at) VALUES(?,?,?,?)")
                .run("pending", "weibo", JSON.stringify([old]), 1);
            const pending: Promise<unknown>[] = [];
            const cache = new Cache(database, { deferMaintenance: (work) => pending.push(work) });
            await cache.openPages(true);
            expect(await cache.get("weibo")).toMatchObject({ items: [old] });
            expect(await cache.getArticleIndexHealth()).toMatchObject({ status: "degraded", pendingIngest: 1 });
            expect(await database.prepare("SELECT count(*) AS count FROM articles").get()).toEqual({ count: 0 });
            let unblock!: () => void;
            const held = new Promise<void>((resolve) => {
                unblock = resolve;
            });
            const replay = vi.spyOn(cache, "maintainArticleIndex").mockReturnValue(held);
            try {
                await cache.set("v2ex", [{ id: "one", title: "New", url: "https://example.test/one" }]);
                await cache.set("hackernews", [{ id: "two", title: "New", url: "https://example.test/two" }]);
                expect(pending).toHaveLength(1);
                expect(replay).toHaveBeenCalledExactlyOnceWith(1);
                expect(await database.prepare("SELECT count(*) AS count FROM article_ingest_pending").get()).toEqual({
                    count: 3,
                });
                expect(await cache.get("v2ex")).toBeDefined();
            } finally {
                unblock();
                await Promise.all(pending);
            }
            replay.mockRestore();
            await cache.maintainArticleIndex(1);
            expect(await database.prepare("SELECT count(*) AS count FROM articles").get()).toEqual({ count: 1 });
            expect(await cache.getArticleIndexHealth()).toMatchObject({ pendingIngest: 2 });
        } finally {
            await database.dispose();
        }
    });

    it("keeps pre-migration Pages source cache readable without migrating on a read", async () => {
        const db = createDatabase(sqliteConnector({ name: ":memory:" }));
        try {
            await db.prepare("CREATE TABLE cache(id TEXT PRIMARY KEY, updated INTEGER, data TEXT)").run();
            await db.prepare("CREATE TABLE articles(article_key TEXT PRIMARY KEY)").run();
            await db.prepare("INSERT INTO articles VALUES('old-key')").run();
            const item = { id: "legacy", title: "Legacy", url: "https://example.test/legacy" };
            await db.prepare("INSERT INTO cache VALUES(?,?,?)").run("weibo", 1, JSON.stringify([item]));
            const { Cache } = await import("./cache");
            const defer = vi.fn();
            const cache = new Cache(db, { deferMaintenance: defer });
            await cache.openPages(true);
            expect(await cache.get("weibo")).toMatchObject({ items: [item] });
            expect(await cache.searchArticles({ query: "Legacy" })).toMatchObject({ status: "unavailable" });
            expect(await db.prepare("SELECT article_key FROM articles").get()).toEqual({ article_key: "old-key" });
            expect(
                await db.prepare("SELECT name FROM sqlite_master WHERE name='article_schema_migrations'").get()
            ).toBeUndefined();
            expect(defer).not.toHaveBeenCalled();
        } finally {
            await db.dispose();
        }
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
