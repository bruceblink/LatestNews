import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabase } from "db0";
import { rm, mkdtemp } from "node:fs/promises";
import { it, vi, expect, describe } from "vitest";
import sqliteConnector from "db0/connectors/better-sqlite3";

import { Cache } from "./cache-store";
import { ArticleIndex } from "./article-index";
import { ftsIsInconsistent } from "./article-recovery";
import { ownsMaintenanceLease, acquireMaintenanceLease, releaseMaintenanceLease } from "./article-maintenance";

const article = (id: string, title = "Maintenance fixture " + id) => ({
    id,
    title,
    url: "https://example.test/maintenance/" + id,
});

async function fixture(run: (db: ReturnType<typeof createDatabase>, cache: Cache) => Promise<void>) {
    const db = createDatabase(sqliteConnector({ name: ":memory:" }));
    try {
        const cache = new Cache(db);
        await cache.init();
        await run(db, cache);
    } finally {
        await db.dispose();
    }
}

async function append(
    db: ReturnType<typeof createDatabase>,
    id: string,
    source: string,
    payload: string,
    now = Date.now()
) {
    await db
        .prepare("INSERT INTO article_ingest_pending(id,source_id,payload,observed_at) VALUES(?,?,?,?)")
        .run(id, source, payload, now);
}

describe("N4-P2 independent index maintenance", () => {
    it("drains three rounds of 30 sources independently, keeping newer observations", async () => {
        await fixture(async (db, cache) => {
            for (let round = 0; round < 3; round++) {
                const owner = (await acquireMaintenanceLease(db))!;
                for (let i = 0; i < 30; i++) {
                    await cache.set(
                        "source-" + i,
                        Array.from({ length: 30 }, (_, j) =>
                            article(i + "-" + j, "Round " + round + " item " + i + "-" + j)
                        )
                    );
                }
                expect((await cache.getArticleIndexHealth()).pendingIngest).toBe(30);
                await releaseMaintenanceLease(db, owner);
                let completed = 0;
                for (let pass = 0; pass < 20; pass++) {
                    const result = await cache.runArticleMaintenance(5);
                    expect(result.attempted).toBeLessThanOrEqual(5);
                    completed += result.completed;
                    if (result.status === "ok") break;
                }
                expect(completed).toBe(30);
                expect(await cache.getArticleIndexHealth()).toMatchObject({
                    status: "ok",
                    pendingIngest: 0,
                    pendingFts: 0,
                    untrackedCache: 0,
                });
            }
            expect(await db.prepare("SELECT COUNT(*) AS count FROM articles").get()).toEqual({ count: 900 });
            expect(await db.prepare("SELECT COUNT(*) AS count FROM article_sources").get()).toEqual({ count: 900 });
            expect(
                await db.prepare("SELECT COUNT(*) AS count FROM articles WHERE title LIKE 'Round 2%'").get()
            ).toEqual({ count: 900 });
            expect(await ftsIsInconsistent(db)).toBe(false);
        });
    });

    it("uses a durable cross-connection lease and cannot release a replacement owner", async () => {
        const dir = await mkdtemp(join(tmpdir(), "ln-maintenance-"));
        const a = createDatabase(sqliteConnector({ path: join(dir, "db.sqlite") }));
        let b = createDatabase(sqliteConnector({ path: join(dir, "db.sqlite") }));
        try {
            await new Cache(a).init();
            const first = (await acquireMaintenanceLease(a))!;
            const other = new Cache(b);
            await other.check(false);
            expect((await other.runArticleMaintenance()).status).toBe("busy");
            await b.dispose();
            b = createDatabase(sqliteConnector({ path: join(dir, "db.sqlite") }));
            await a.prepare("UPDATE article_maintenance_lease SET expires_at=0").run();
            const next = (await acquireMaintenanceLease(b))!;
            expect(next).not.toBe(first);
            await releaseMaintenanceLease(a, first);
            expect(await ownsMaintenanceLease(b, next)).toBe(true);
            await releaseMaintenanceLease(b, next);
            const resumed = new Cache(b);
            await resumed.check(false);
            expect((await resumed.runArticleMaintenance()).status).toBe("ok");
        } finally {
            await a.dispose();
            await b.dispose();
            await rm(dir, { recursive: true, force: true });
        }
    });

    it("chunks large snapshots, survives reopened cache and preserves the latest write", async () => {
        await fixture(async (db, cache) => {
            const items = Array.from({ length: 65 }, (_, i) => article("large-" + i));
            await append(db, "large", "weibo", JSON.stringify(items), 1000);
            expect(await cache.runArticleMaintenance(1)).toMatchObject({
                status: "pending",
                attempted: 1,
                advanced: 1,
                completed: 0,
            });
            expect(await db.prepare("SELECT next_offset FROM article_ingest_work WHERE id='large'").get()).toEqual({
                next_offset: 30,
            });
            const index = new ArticleIndex(db);
            await index.probe(false);
            await index.upsertSourceItems("weibo", [{ ...items[40], title: "New title survives" }], 2000);
            const reopened = new Cache(db);
            await reopened.check(false);
            expect(await reopened.runArticleMaintenance(1)).toMatchObject({ advanced: 1, completed: 0 });
            expect(await reopened.runArticleMaintenance(1)).toMatchObject({ status: "ok", completed: 1 });
            expect(await db.prepare("SELECT COUNT(*) AS count FROM articles").get()).toEqual({ count: 65 });
            expect((await reopened.searchArticles({ query: "New title survives" })).items).toHaveLength(1);
            expect(await db.prepare("SELECT COUNT(*) AS count FROM article_ingest_work").get()).toEqual({ count: 0 });
        });
    });

    it("retains poison rows, backs off and allows other rows to make progress", async () => {
        await fixture(async (db, cache) => {
            await append(db, "poison", "weibo", "{", 1);
            await append(db, "valid", "v2ex", JSON.stringify([article("valid")]), 2);
            expect(await cache.runArticleMaintenance(1)).toMatchObject({
                failed: 1,
                remaining: { attempts: 1, pendingIngest: 2 },
            });
            expect(await cache.runArticleMaintenance(1)).toMatchObject({
                failed: 1,
                remaining: { attempts: 2, deferred: 1 },
            });
            expect(await cache.runArticleMaintenance(1)).toMatchObject({
                completed: 1,
                remaining: { pendingIngest: 1, deferred: 1, oldestObservedAt: 1 },
            });
            expect(await db.prepare("SELECT payload FROM article_ingest_pending WHERE id='poison'").get()).toEqual({
                payload: "{",
            });
            expect(await cache.runArticleMaintenance(1)).toMatchObject({ status: "pending", attempted: 0 });
        });
    });

    it("stops before another chunk on cancellation and fences stale checkpoint owners", async () => {
        await fixture(async (db, cache) => {
            await append(db, "a", "weibo", JSON.stringify([article("a")]));
            await append(db, "b", "v2ex", JSON.stringify([article("b")]));
            const cancel = new AbortController();
            cancel.abort();
            expect(await cache.runArticleMaintenance(2, cancel.signal)).toMatchObject({
                status: "interrupted",
                attempted: 0,
            });
            const original = ArticleIndex.prototype.upsertSourceItems;
            let replacement: string | undefined;
            const spy = vi
                .spyOn(ArticleIndex.prototype, "upsertSourceItems")
                .mockImplementation(async function upsertWithTakeover(this: ArticleIndex, ...args) {
                    const result = await original.apply(this, args);
                    await db.prepare("UPDATE article_maintenance_lease SET expires_at=0").run();
                    replacement = await acquireMaintenanceLease(db);
                    return result;
                });
            try {
                expect(await cache.runArticleMaintenance(2)).toMatchObject({
                    status: "pending",
                    attempted: 1,
                    completed: 0,
                });
                expect(await ownsMaintenanceLease(db, replacement!)).toBe(true);
                expect((await cache.getArticleIndexHealth()).pendingIngest).toBe(2);
            } finally {
                spy.mockRestore();
                await releaseMaintenanceLease(db, replacement!);
            }
            expect(await cache.runArticleMaintenance(2)).toMatchObject({ status: "ok", completed: 2 });
            expect(await ftsIsInconsistent(db)).toBe(false);
        });
    });

    it("finishes only the current chunk on cancellation or cooperative time-budget expiry", async () => {
        await fixture(async (db, cache) => {
            await append(db, "a", "weibo", JSON.stringify([article("a")]), 1);
            await append(db, "b", "v2ex", JSON.stringify([article("b")]), 2);
            const controller = new AbortController();
            const original = ArticleIndex.prototype.upsertSourceItems;
            const spy = vi
                .spyOn(ArticleIndex.prototype, "upsertSourceItems")
                .mockImplementation(async function cancelAfterChunk(this: ArticleIndex, ...args) {
                    const result = await original.apply(this, args);
                    controller.abort();
                    return result;
                });
            try {
                expect(await cache.runArticleMaintenance(2, controller.signal)).toMatchObject({
                    status: "interrupted",
                    attempted: 1,
                    completed: 1,
                    remaining: { pendingIngest: 1 },
                });
            } finally {
                spy.mockRestore();
            }
            await append(db, "c", "weibo", JSON.stringify([article("c")]), 3);
            let elapsed = 0;
            const clock = vi.spyOn(performance, "now").mockImplementation(() => elapsed);
            const slow = vi
                .spyOn(ArticleIndex.prototype, "upsertSourceItems")
                .mockImplementation(async function slowChunk(this: ArticleIndex, ...args) {
                    const result = await original.apply(this, args);
                    elapsed = 5001;
                    return result;
                });
            try {
                expect(await cache.runArticleMaintenance(2)).toMatchObject({
                    status: "pending",
                    attempted: 1,
                    completed: 1,
                    remaining: { pendingIngest: 1 },
                });
            } finally {
                clock.mockRestore();
                slow.mockRestore();
            }
            expect(await cache.runArticleMaintenance()).toMatchObject({
                status: "ok",
                completed: 1,
                remaining: { pendingIngest: 0 },
            });
        });
    });

    it("keeps a newer cache journal committed during a maintenance pass", async () => {
        await fixture(async (db, cache) => {
            const old = article("same", "Old observation");
            const owner = (await acquireMaintenanceLease(db))!;
            await cache.set("weibo", [old]);
            await releaseMaintenanceLease(db, owner);
            const writer = new Cache(db);
            await writer.check(false);
            const original = ArticleIndex.prototype.upsertSourceItems;
            const spy = vi
                .spyOn(ArticleIndex.prototype, "upsertSourceItems")
                .mockImplementation(async function concurrentCacheWrite(this: ArticleIndex, ...args) {
                    const result = await original.apply(this, args);
                    await writer.set("weibo", [{ ...old, title: "Latest observation" }]);
                    return result;
                });
            try {
                expect(await cache.runArticleMaintenance(1)).toMatchObject({
                    completed: 1,
                    remaining: { pendingIngest: 1 },
                });
            } finally {
                spy.mockRestore();
            }
            expect((await writer.get("weibo"))?.items[0].title).toBe("Latest observation");
            expect(await cache.runArticleMaintenance()).toMatchObject({ status: "ok", completed: 1 });
            expect((await cache.searchArticles({ query: "Latest observation" })).items).toHaveLength(1);
            expect((await cache.searchArticles({ query: "Old observation" })).items).toHaveLength(0);
            expect(await ftsIsInconsistent(db)).toBe(false);
        });
    });

    it("rejects stale article writes atomically after a replacement lease is acquired", async () => {
        await fixture(async (db, cache) => {
            const index = new ArticleIndex(db);
            await index.probe(false);
            const first = (await acquireMaintenanceLease(db))!;
            await db.prepare("UPDATE article_maintenance_lease SET expires_at=0").run();
            const next = (await acquireMaintenanceLease(db))!;
            await index.upsertSourceItems("weibo", [article("same", "Newer lease title")], 1000, next);
            await expect(
                index.upsertSourceItems("weibo", [article("same", "Stale lease title")], 1000, first)
            ).rejects.toThrow();
            expect((await cache.searchArticles({ query: "Newer lease title" })).items).toHaveLength(1);
            expect((await cache.searchArticles({ query: "Stale lease title" })).items).toHaveLength(0);
            await releaseMaintenanceLease(db, next);
        });
    });
});
