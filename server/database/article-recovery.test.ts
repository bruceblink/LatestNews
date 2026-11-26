import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabase } from "db0";
import { it, expect, describe } from "vitest";
import { spawnSync } from "node:child_process";
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
                Array.from({ length: 412 }, (_, i) => article(String(i)))
            );
            await db.prepare("DELETE FROM article_search").run();
            await beginFtsRepair(db);
            expect(await repairFtsPage(db)).toEqual({ done: false, indexed: 0 }); // empty clear stage
            const first = await repairFtsPage(db);
            expect(first.indexed).toBe(200);
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
            expect(await db.prepare("SELECT count(*) AS count FROM article_search").get()).toEqual({ count: 413 });
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
            expect(pages.reduce((sum, page) => sum + page.indexed, 0)).toBe(200);
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

    it.skipIf(process.platform === "win32")(
        "rolls back a killed build transaction, resumes committed pages and replays cross-connection writes",
        async () => {
            const dir = await mkdtemp(join(tmpdir(), "ln-fts-crash-"));
            const path = join(dir, "recovery.sqlite3");
            let db = createDatabase(sqliteConnector({ path }));
            let writer: ReturnType<typeof createDatabase> | undefined;
            const state = () => db.prepare("SELECT phase,cursor,generation FROM article_fts_repair WHERE id=1").get();
            const count = () => db.prepare("SELECT count(*) AS count FROM article_search").get();
            const crashWorker = (mode: "during" | "after" | "verify") => {
                // Use the real SQLite connector and recovery implementation in a separate process.
                // SIGKILL bypasses graceful disposal; only the temporary fixture can be affected.
                const child = spawnSync(
                    process.execPath,
                    [
                        "--import",
                        "tsx",
                        "--input-type=module",
                        "-e",
                        `
                import { createDatabase } from "db0";
                import sqliteConnector from "db0/connectors/better-sqlite3";
                import { repairFtsPage } from "./server/database/article-recovery.ts";
                const db = createDatabase(sqliteConnector({ path: process.argv[1] }));
                if (process.argv[2] !== "after") {
                    const native = await db.getInstance();
                    const prepare = native.prepare.bind(native);
                    native.prepare = (sql) => {
                        // The FTS insert and pending-key delete have executed, but the
                        // transaction has not advanced the cursor or committed.
                        if ((process.argv[2] === "during" && sql.startsWith("UPDATE article_fts_repair SET cursor=?") && sql.includes("RETURNING id")) ||
                            (process.argv[2] === "verify" && sql.startsWith("UPDATE article_fts_repair SET phase='ready'") && sql.includes("RETURNING id"))) {
                            process.kill(process.pid, "SIGKILL");
                        }
                        return prepare(sql);
                    };
                }
                const result = await repairFtsPage(db);
                if (result.indexed !== 200 || process.argv[2] !== "after") process.exit(31);
                process.kill(process.pid, "SIGKILL");
                `,
                        path,
                        mode,
                    ],
                    { encoding: "utf8", timeout: 10000 }
                );
                expect(child.error).toBeUndefined();
                expect(child.signal, child.stderr).toBe("SIGKILL");
            };
            try {
                const index = new ArticleIndex(db);
                await index.init();
                await index.upsertSourceItems(
                    "weibo",
                    Array.from({ length: 450 }, (_, i) => article("crash-" + i))
                );
                await beginFtsRepair(db);
                await repairFtsPage(db);
                expect(await count()).toEqual({ count: 250 });
                const clearCheckpoint = await state();
                await db.dispose();
                db = createDatabase(sqliteConnector({ path }));
                expect(await state()).toEqual(clearCheckpoint);
                await repairFtsPage(db);
                await repairFtsPage(db);
                expect(await count()).toEqual({ count: 0 });
                const start = await state();
                expect(start).toMatchObject({ cursor: "build-start" });

                await db.dispose();
                crashWorker("during");
                db = createDatabase(sqliteConnector({ path }));
                expect(await state()).toEqual(start);
                expect(await count()).toEqual({ count: 0 });
                await db.dispose();
                crashWorker("after");

                db = createDatabase(sqliteConnector({ path }));
                expect(await state()).toMatchObject({ phase: "repairing", cursor: expect.stringMatching(/^build:/) });
                expect(await count()).toEqual({ count: 200 });
                const committed = (await state()) as { cursor: string; generation: string };
                expect(committed.generation).toBe((start as { generation: string }).generation);
                const behind = (await db
                    .prepare("SELECT payload FROM articles ORDER BY article_key LIMIT 1")
                    .get()) as {
                    payload: string;
                };
                const ahead = (await db
                    .prepare("SELECT payload FROM articles ORDER BY article_key DESC LIMIT 1")
                    .get()) as { payload: string };
                const resumed = new ArticleIndex(db);
                await resumed.probe();
                writer = createDatabase(sqliteConnector({ path }));
                const other = new ArticleIndex(writer);
                await other.probe();
                const changed = { ...JSON.parse(behind.payload), title: "Fresh behind cursor" };
                const future = { ...JSON.parse(ahead.payload), title: "Fresh ahead cursor" };
                const late = article("crash-new", "Fresh new article");
                const now = Date.now() + 1000;
                await Promise.all([
                    resumed.continueRepair(1),
                    other.continueRepair(1),
                    other.upsertSourceItems("v2ex", [changed, future, late], now),
                    resumed.upsertSourceItems("weibo", [{ ...changed, title: "Stale replay" }], now - 1),
                ]);
                expect((await resumed.search({ query: "Fresh behind cursor" })).mode).toBe("like");
                // Stop exactly at the verify checkpoint and reopen again.
                for (let i = 0; i < 10; i++) {
                    if (((await state()) as { cursor: string }).cursor === "verify") break;
                    await repairFtsPage(db);
                }
                expect(await state()).toMatchObject({ cursor: "verify", generation: committed.generation });
                const preAudit = await db.prepare("SELECT * FROM article_fts_audit").get();
                await db.dispose();
                await writer.dispose();
                writer = undefined;
                // Kill after the certificate INSERT but before the ready UPDATE.
                crashWorker("verify");
                db = createDatabase(sqliteConnector({ path }));
                expect(await state()).toMatchObject({ cursor: "verify", generation: committed.generation });
                expect(await db.prepare("SELECT * FROM article_fts_audit").get()).toEqual(preAudit);
                const verified = new ArticleIndex(db);
                await verified.probe();
                expect((await verified.search({ query: "Fresh behind cursor" })).mode).toBe("like");
                writer = createDatabase(sqliteConnector({ path }));
                const verifyWriter = new ArticleIndex(writer);
                await verifyWriter.probe();
                const lastTitle = { ...late, title: "Fresh verification update" };
                await Promise.all([
                    verified.continueRepair(1),
                    verifyWriter.upsertSourceItems("v2ex", [lastTitle], now + 1),
                ]);
                expect((await verified.continueRepair()).status).toBe("ok");
                expect(await ftsIsInconsistent(db)).toBe(false);
                expect(await count()).toEqual({ count: 451 });
                expect(await db.prepare("SELECT count(*) AS count FROM articles").get()).toEqual({ count: 451 });
                expect(await db.prepare("SELECT count(*) AS count FROM article_sources").get()).toEqual({ count: 453 });
                expect(await verified.getRecoveryStatus()).toMatchObject({
                    status: "ok",
                    pendingFts: 0,
                    ftsAudit: { status: "verified" },
                });
                expect(await db.prepare("SELECT generation,valid FROM article_fts_audit").get()).toEqual({
                    generation: committed.generation,
                    valid: 1,
                });
                for (const title of [changed.title, future.title, lastTitle.title]) {
                    const result = await verified.search({ query: title });
                    expect(result.mode).toBe("fts");
                    expect(result.items.map((item) => item.title)).toEqual([title]);
                }
                expect((await verified.search({ query: "Fresh behind cursor" })).items[0].sourceIds).toEqual([
                    "v2ex",
                    "weibo",
                ]);
                expect((await verified.search({ query: "Stale replay" })).items).toEqual([]);
            } finally {
                await writer?.dispose();
                await db.dispose();
                await rm(dir, { recursive: true, force: true });
            }
        },
        30000
    );

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
