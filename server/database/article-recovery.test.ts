import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabase } from "db0";
import { it, expect, describe } from "vitest";
import { rm, mkdtemp } from "node:fs/promises";
import sqliteConnector from "db0/connectors/better-sqlite3";

import { Cache } from "./cache-store";
import { ArticleIndex } from "./article-index";
import { repairFtsPage, beginFtsRepair, ftsIsInconsistent } from "./article-recovery";

const article = (id: string, title = "Recovery article " + id) => ({
    id,
    title,
    url: "https://example.test/recovery/" + id,
    pubDate: 1795550000000,
});
async function fixture(run: (db: ReturnType<typeof createDatabase>, index: ArticleIndex) => Promise<void>) {
    const db = createDatabase(sqliteConnector({ name: ":memory:" }));
    try {
        const index = new ArticleIndex(db);
        await index.init();
        await run(db, index);
    } finally {
        await db.dispose();
    }
}

describe("N4-L2 durable article recovery", () => {
    it("detects same-count duplicate, missing, stale and orphaned FTS rows", async () => {
        await fixture(async (db, index) => {
            await index.upsertSourceItems("weibo", [article("a"), article("b"), article("c")]);
            const rows = (await db
                .prepare("SELECT article_key,title,canonical_url FROM articles ORDER BY title")
                .all()) as Array<{ article_key: string; title: string; canonical_url: string }>;
            await db.prepare("DELETE FROM article_search WHERE article_key=?").run(rows[1].article_key);
            await db
                .prepare("INSERT INTO article_search VALUES(?,?,?)")
                .run(rows[0].article_key, rows[0].title, rows[0].canonical_url);
            expect(await ftsIsInconsistent(db)).toBe(true);
            await db.prepare("UPDATE article_search SET title='stale' WHERE article_key=?").run(rows[2].article_key);
            await db
                .prepare("INSERT INTO article_search VALUES('orphan','orphan','https://example.test/orphan')")
                .run();
            const reopened = new ArticleIndex(db);
            await reopened.init();
            expect(await ftsIsInconsistent(db)).toBe(false);
            const result = await reopened.search({ query: "Recovery" });
            expect(result.mode).toBe("fts");
            expect(result.items.map((item) => item.item.id).sort()).toEqual(["a", "b", "c"]);
        });
    });
    it("resumes bounded rebuild after a restart and uses literal reads while pending", async () => {
        await fixture(async (db, index) => {
            await index.upsertSourceItems(
                "weibo",
                Array.from({ length: 112 }, (_, i) => article(String(i)))
            );
            await db.prepare("DELETE FROM article_search").run();
            await beginFtsRepair(db);
            expect(await repairFtsPage(db)).toEqual({ done: false, indexed: 0 }); // empty clear stage
            const first = await repairFtsPage(db);
            expect(first.indexed).toBe(50);
            expect(first.done).toBe(false);
            expect((await index.search({ query: "Recovery", limit: 100 })).mode).toBe("like");
            const reopened = new ArticleIndex(db);
            await reopened.probe();
            expect((await reopened.getRecoveryStatus()).status).toBe("degraded");
            await Promise.all([
                reopened.continueRepair(1),
                index.continueRepair(1),
                index.upsertSourceItems("v2ex", [article("new")]),
            ]);
            await reopened.continueRepair();
            expect(await ftsIsInconsistent(db)).toBe(false);
            expect((await reopened.getRecoveryStatus()).status).toBe("ok");
            expect(await db.prepare("SELECT count(*) AS count FROM article_search").get()).toEqual({ count: 113 });
        });
    });
    it("bounds derived-row clearing, preserves articles and replays writes behind the build cursor", async () => {
        await fixture(async (db, index) => {
            await index.upsertSourceItems(
                "weibo",
                Array.from({ length: 450 }, (_, i) => article("bulk-" + i))
            );
            await beginFtsRepair(db);
            expect(await repairFtsPage(db)).toEqual({ done: false, indexed: 0 });
            expect(await db.prepare("SELECT count(*) AS count FROM article_search").get()).toEqual({ count: 250 });
            expect(await db.prepare("SELECT count(*) AS count FROM articles").get()).toEqual({ count: 450 });
            expect((await index.search({ query: "Recovery" })).mode).toBe("like");
            const active = await db.prepare("SELECT cursor,generation FROM article_fts_repair").get();
            expect(active).toMatchObject({ cursor: "clear" });
            await index.upsertSourceItems("weibo", [article("during-clear")]);
            expect(await db.prepare("SELECT count(*) AS count FROM article_fts_pending").get()).toEqual({ count: 1 });
            expect(await db.prepare("SELECT count(*) AS count FROM article_search").get()).toEqual({ count: 250 });
            await Promise.all([repairFtsPage(db), repairFtsPage(db)]);
            expect(await db.prepare("SELECT count(*) AS count FROM article_search").get()).toEqual({ count: 0 });
            const pages = await Promise.all([repairFtsPage(db), repairFtsPage(db)]);
            expect(pages.reduce((sum, page) => sum + page.indexed, 0)).toBe(50);
            const first = (await db.prepare("SELECT payload FROM articles ORDER BY article_key LIMIT 1").get()) as {
                payload: string;
            };
            const updated = { ...JSON.parse(first.payload), title: "Updated behind cursor" };
            await index.upsertSourceItems("v2ex", [updated], Date.now() + 100);
            expect((await index.search({ query: "Updated behind cursor" })).mode).toBe("like");
            const reopened = new ArticleIndex(db);
            await reopened.probe();
            let result = await reopened.continueRepair(1);
            for (let i = 0; i < 25 && result.status === "pending"; i++) result = await reopened.continueRepair(1);
            expect(result.status).toBe("ok");
            expect(await ftsIsInconsistent(db)).toBe(false);
            expect(await db.prepare("SELECT count(*) AS count FROM article_search").get()).toEqual({ count: 451 });
            const resultItems = await reopened.search({ query: "Updated behind cursor" });
            expect(resultItems).toMatchObject({
                mode: "fts",
                items: [expect.objectContaining({ title: updated.title, sourceIds: ["v2ex", "weibo"] })],
            });
        });
    });

    it("restarts legacy partial generations and never publishes a failed verification", async () => {
        await fixture(async (db, index) => {
            await index.upsertSourceItems("weibo", [article("legacy-a"), article("legacy-b")]);
            await db
                .prepare("UPDATE article_fts_repair SET phase='repairing',cursor='old-key',generation='legacy-uuid'")
                .run();
            expect(await repairFtsPage(db)).toEqual({ done: false, indexed: 0 });
            expect(await db.prepare("SELECT cursor,generation FROM article_fts_repair").get()).toEqual({
                cursor: "clear",
                generation: expect.stringMatching(/^fts-v2:/),
            });
            await repairFtsPage(db); // clear
            await repairFtsPage(db); // build
            await repairFtsPage(db); // transition to verify
            expect(await db.prepare("SELECT cursor FROM article_fts_repair").get()).toEqual({ cursor: "verify" });
            await db.prepare("DELETE FROM article_search WHERE rowid=(SELECT min(rowid) FROM article_search)").run();
            expect(await repairFtsPage(db)).toEqual({ done: false, indexed: 0 });
            expect(await db.prepare("SELECT phase,cursor FROM article_fts_repair").get()).toEqual({
                phase: "repairing",
                cursor: "clear",
            });
            expect((await index.search({ query: "Recovery" })).mode).toBe("like");
            expect((await index.continueRepair()).status).toBe("ok");
            expect(await ftsIsInconsistent(db)).toBe(false);
        });
    });

    it("keeps failed FTS updates queued and recovers without losing articles", async () => {
        await fixture(async (db, index) => {
            await db.prepare("DROP TABLE article_search").run();
            await index.upsertSourceItems("weibo", [article("a")]);
            expect((await index.getRecoveryStatus()).pendingFts).toBe(1);
            expect((await index.search({ query: "Recovery" })).items).toHaveLength(1);
            const reopened = new ArticleIndex(db);
            await reopened.init();
            expect((await reopened.getRecoveryStatus()).pendingFts).toBe(0);
            expect((await reopened.search({ query: "Recovery" })).mode).toBe("fts");
        });
    });
    it("coalesces identical in-flight writes and serializes replay without duplicating observations", async () => {
        await fixture(async (db) => {
            const cache = new Cache(db);
            await cache.init();
            await db.prepare("CREATE TABLE writes (kind TEXT NOT NULL)").run();
            await db
                .prepare(
                    "CREATE TRIGGER count_insert AFTER INSERT ON articles BEGIN INSERT INTO writes VALUES('insert'); END"
                )
                .run();
            await db
                .prepare(
                    "CREATE TRIGGER count_update AFTER UPDATE ON articles BEGIN INSERT INTO writes VALUES('update'); END"
                )
                .run();
            const items = [article("singleflight")];
            await Promise.all(Array.from({ length: 20 }, () => cache.set("weibo", items)));
            expect(await db.prepare("SELECT kind FROM writes").all()).toEqual([{ kind: "insert" }]);
            await cache.set("weibo", items);
            expect(await db.prepare("SELECT kind FROM writes").all()).toEqual([{ kind: "insert" }, { kind: "update" }]);
            await Promise.all(
                Array.from({ length: 12 }, (_, i) => cache.set("source-" + i, [article("parallel-" + i)]))
            );
            expect(await db.prepare("SELECT COUNT(*) AS count FROM writes").get()).toEqual({ count: 14 });
            expect(await cache.getArticleIndexHealth()).toMatchObject({
                status: "ok",
                pendingIngest: 0,
                pendingFts: 0,
                untrackedCache: 0,
            });
        });
    });

    it("does not coalesce distinct payloads or a later return to an older payload", async () => {
        await fixture(async (db) => {
            const cache = new Cache(db);
            await cache.init();
            const first = article("same", "First title");
            const changed = { ...first, title: "Changed title" };
            await Promise.all([
                cache.set("weibo", [first]),
                cache.set("weibo", [changed]),
                cache.set("weibo", [first]),
            ]);
            expect((await cache.get("weibo"))?.items).toEqual([first]);
            expect((await cache.searchArticles({ query: "First title" })).items).toHaveLength(1);
            expect((await cache.searchArticles({ query: "Changed title" })).items).toHaveLength(0);
            expect(await cache.getArticleIndexHealth()).toMatchObject({ status: "ok", pendingIngest: 0 });
        });
    });

    it("retains a failed cache snapshot across restart and replays it after recovery", async () => {
        const dir = await mkdtemp(join(tmpdir(), "ln-recovery-"));
        const path = join(dir, "db.sqlite3");
        let db = createDatabase(sqliteConnector({ path }));
        try {
            let cache = new Cache(db);
            await cache.init();
            await db
                .prepare(
                    "CREATE TRIGGER fail_mapping BEFORE INSERT ON article_sources BEGIN SELECT RAISE(ABORT,'injected mapping failure'); END"
                )
                .run();
            await cache.set("weibo", [article("a")]);
            expect((await cache.get("weibo"))?.items).toHaveLength(1);
            expect(await cache.getArticleIndexHealth()).toMatchObject({ status: "degraded", pendingIngest: 1 });
            await db.dispose();
            db = createDatabase(sqliteConnector({ path }));
            await db.prepare("DROP TRIGGER fail_mapping").run();
            cache = new Cache(db);
            await cache.init();
            expect(await cache.getArticleIndexHealth()).toMatchObject({
                status: "ok",
                pendingIngest: 0,
                pendingFts: 0,
                untrackedCache: 0,
            });
            expect((await cache.searchArticles({ query: "Recovery" })).items).toHaveLength(1);
        } finally {
            await db.dispose();
            await rm(dir, { recursive: true, force: true });
        }
    });
    it("replays old snapshots without reverting a later title or losing another source", async () => {
        await fixture(async (db, index) => {
            const a = article("a", "new title");
            await index.upsertSourceItems("weibo", [a], 2000);
            await index.upsertSourceItems("weibo", [{ ...a, title: "old title" }], 1000);
            await index.upsertSourceItems("v2ex", [{ ...a, title: "older title" }], 500);
            const row = (await index.search({ query: "new title" })).items[0];
            expect(row.title).toBe("new title");
            expect(row.sourceIds).toEqual(["v2ex", "weibo"]);
            expect(await db.prepare("SELECT first_seen_at,last_seen_at FROM articles").get()).toEqual({
                first_seen_at: 500,
                last_seen_at: 2000,
            });
        });
    });
    it("probes an existing managed schema without DDL and discovers untracked cache snapshots", async () => {
        await fixture(async (db) => {
            await db.prepare("CREATE TABLE cache(id TEXT PRIMARY KEY, updated INTEGER,data TEXT)").run();
            await db.prepare("INSERT INTO cache VALUES(?,?,?)").run("weibo", 1000, JSON.stringify([article("a")]));
            const cache = new Cache(db);
            await cache.check();
            expect(await cache.getArticleIndexHealth()).toMatchObject({ status: "degraded", untrackedCache: 1 });
            await cache.maintainArticleIndex();
            expect(await cache.getArticleIndexHealth()).toMatchObject({ status: "ok", untrackedCache: 0 });
            expect((await cache.searchArticles({ query: "Recovery" })).mode).toBe("fts");
        });
    });
    it("retains source reads on old cache-only schema, without implicitly migrating", async () => {
        const db = createDatabase(sqliteConnector({ name: ":memory:" }));
        try {
            await db.prepare("CREATE TABLE cache(id TEXT PRIMARY KEY, updated INTEGER,data TEXT)").run();
            const cache = new Cache(db);
            await cache.check();
            await cache.set("weibo", [article("a")]);
            expect((await cache.get("weibo"))?.items).toHaveLength(1);
            expect((await cache.getArticleIndexHealth()).status).toBe("unavailable");
            expect(
                await db.prepare("SELECT name FROM sqlite_master WHERE name='article_schema_migrations'").get()
            ).toBeUndefined();
        } finally {
            await db.dispose();
        }
    });
});
