import { createDatabase } from "db0";
import { it, expect, describe } from "vitest";
import sqliteConnector from "db0/connectors/better-sqlite3";

import { Cache } from "./cache-store";
import { ArticleIndex } from "./article-index";
import {
    readFtsAudit,
    auditReadyFts,
    repairFtsPage,
    beginFtsRepair,
    ftsIsInconsistent,
    FTS_AUDIT_VERSION,
    FTS_AUDIT_MAX_AGE_MS,
} from "./article-recovery";

const item = (n: number) => ({
    id: String(n),
    title: "Audit Alpha " + n,
    url: "https://example.test/audit/" + n,
    pubDate: 1795550000000,
});
async function fixture(run: (db: ReturnType<typeof createDatabase>, index: ArticleIndex) => Promise<void>) {
    const db = createDatabase(sqliteConnector({ name: ":memory:" }));
    try {
        const index = new ArticleIndex(db);
        await index.init();
        await index.upsertSourceItems("weibo", [item(1), item(2)]);
        await db.prepare("CREATE TABLE cache(id TEXT PRIMARY KEY,updated INTEGER,data TEXT)").run();
        await run(db, index);
    } finally {
        await db.dispose();
    }
}
const openPages = async (db: ReturnType<typeof createDatabase>, autoInit = false) => {
    const cache = new Cache(db, { deferMaintenance: () => {} });
    await cache.openPages(autoInit);
    return cache;
};
const query = { query: "Alpha" };
const proof = (db: ReturnType<typeof createDatabase>) => db.prepare("SELECT * FROM article_fts_audit").get();

describe("N4-P1 persisted FTS audit evidence", () => {
    it("does not advertise a legacy ready index without proof (A10); additive upgrade does not audit on read", async () => {
        await fixture(async (db, index) => {
            await db.prepare("DROP TABLE article_fts_audit").run();
            await db.prepare("DELETE FROM article_search WHERE canonical_url=?").run(item(2).url);
            expect(await ftsIsInconsistent(db)).toBe(true);
            const legacy = await openPages(db);
            expect(await legacy.getArticleIndexHealth()).toMatchObject({
                status: "degraded",
                fts: "degraded",
                ftsAudit: { status: "unverified" },
            });
            expect(await legacy.searchArticles(query)).toMatchObject({
                mode: "like",
                items: expect.arrayContaining([expect.objectContaining({ title: item(2).title })]),
            });
            expect(await db.prepare("SELECT name FROM sqlite_master WHERE name='article_fts_audit'").get()).toBeFalsy();
            const upgraded = await openPages(db, true);
            expect(await proof(db)).toBeFalsy();
            expect(await upgraded.getArticleIndexHealth()).toMatchObject({ ftsAudit: { status: "unverified" } });
            expect((await upgraded.searchArticles(query)).items).toHaveLength(2);
            for (let i = 0; i < 6; i++) await upgraded.maintainArticleIndex(1);
            expect(await ftsIsInconsistent(db)).toBe(false);
            expect(await upgraded.getArticleIndexHealth()).toMatchObject({
                status: "ok",
                ftsAudit: { status: "verified" },
            });
            const result = await upgraded.searchArticles(query);
            expect(result.mode).toBe("fts");
            expect(result.items).toHaveLength(2);
            expect(await index.searchLike(query)).toMatchObject({ mode: "like" });
        });
    });

    it.each(["expired", "generation", "version", "future", "invalid"] as const)(
        "degrades fresh requests and already opened readers when proof is %s",
        async (kind) => {
            await fixture(async (db, index) => {
                const before = await openPages(db);
                expect(await before.getArticleIndexHealth()).toMatchObject({
                    status: "ok",
                    ftsAudit: { status: "verified" },
                });
                expect((await before.searchArticles(query)).mode).toBe("fts");
                if (kind === "expired")
                    await db
                        .prepare("UPDATE article_fts_audit SET audited_at=?")
                        .run(Date.now() - FTS_AUDIT_MAX_AGE_MS - 1000);
                else if (kind === "generation")
                    await db.prepare("UPDATE article_fts_audit SET generation='obsolete'").run();
                else if (kind === "version")
                    await db.prepare("UPDATE article_fts_audit SET version=?").run(FTS_AUDIT_VERSION + 1);
                else if (kind === "future")
                    await db.prepare("UPDATE article_fts_audit SET audited_at=?").run(Date.now() + 60000);
                else await db.prepare("UPDATE article_fts_audit SET valid=0").run();
                const expected = kind === "expired" ? "expired" : kind === "invalid" ? "failed" : "unverified";
                for (const cache of [before, await openPages(db)]) {
                    expect(await cache.getArticleIndexHealth()).toMatchObject({
                        fts: "degraded",
                        ftsAudit: { status: expected },
                    });
                    const result = await cache.searchArticles(query);
                    expect(result.mode).toBe("like");
                    expect(result.items).toHaveLength(2);
                }
                expect((await index.continueRepair()).status).toBe("ok");
                expect((await before.searchArticles(query)).mode).toBe("fts");
            });
        }
    );

    it("keeps an expired certificate from becoming valid on audit failure and atomically repairs corruption", async () => {
        await fixture(async (db, index) => {
            await db.prepare("UPDATE article_fts_audit SET audited_at=?").run(Date.now() - FTS_AUDIT_MAX_AGE_MS - 1000);
            await db.prepare("DELETE FROM article_search WHERE canonical_url=?").run(item(2).url);
            await db
                .prepare(
                    "CREATE TRIGGER fail_audit BEFORE INSERT ON article_fts_audit BEGIN SELECT RAISE(ABORT,'fixture failure'); END"
                )
                .run();
            const old = await proof(db);
            await expect(auditReadyFts(db)).rejects.toThrow();
            expect(await proof(db)).toEqual(old);
            const cache = await openPages(db);
            expect(await cache.getArticleIndexHealth()).toMatchObject({ ftsAudit: { status: "expired" } });
            expect((await cache.searchArticles(query)).items).toHaveLength(2);
            await db.prepare("DROP TRIGGER fail_audit").run();
            expect((await index.continueRepair()).status).toBe("ok");
            expect(await ftsIsInconsistent(db)).toBe(false);
            expect(await cache.getArticleIndexHealth()).toMatchObject({
                status: "ok",
                ftsAudit: { status: "verified" },
            });
        });
    });

    it("rolls back the audit certificate if the final ready transition fails", async () => {
        await fixture(async (db, index) => {
            await beginFtsRepair(db);
            for (let i = 0; i < 8; i++) {
                const state = (await db.prepare("SELECT cursor FROM article_fts_repair").get()) as { cursor: string };
                if (state.cursor === "verify") break;
                await repairFtsPage(db);
            }
            const state = await db.prepare("SELECT phase,cursor,generation FROM article_fts_repair").get();
            expect(state).toMatchObject({ phase: "repairing", cursor: "verify" });
            const old = await proof(db);
            await db
                .prepare(
                    "CREATE TRIGGER fail_ready BEFORE UPDATE ON article_fts_repair WHEN NEW.phase='ready' BEGIN SELECT RAISE(ABORT,'fixture failure'); END"
                )
                .run();
            await expect(repairFtsPage(db)).rejects.toThrow();
            expect(await proof(db)).toEqual(old);
            expect(await db.prepare("SELECT phase,cursor,generation FROM article_fts_repair").get()).toEqual(state);
            const cache = await openPages(db);
            expect(await cache.getArticleIndexHealth()).toMatchObject({
                fts: "degraded",
                ftsAudit: { status: "unverified" },
            });
            expect((await cache.searchArticles(query)).mode).toBe("like");
            await db.prepare("DROP TRIGGER fail_ready").run();
            expect((await index.continueRepair()).status).toBe("ok");
            expect(await proof(db)).toMatchObject({
                generation: (state as { generation: string }).generation,
                valid: 1,
                version: FTS_AUDIT_VERSION,
            });
        });
    });

    it("renews due evidence in the existing deferred maintenance path without cache backlog", async () => {
        await fixture(async (db) => {
            await db.prepare("UPDATE article_fts_audit SET audited_at=?").run(Date.now() - FTS_AUDIT_MAX_AGE_MS - 1000);
            const cache = await openPages(db);
            expect(await cache.getArticleIndexHealth()).toMatchObject({
                pendingIngest: 0,
                pendingFts: 0,
                untrackedCache: 0,
                ftsAudit: { status: "expired" },
            });
            await cache.schedulePagesBacklogIfNeeded();
            expect(await cache.getArticleIndexHealth()).toMatchObject({
                status: "ok",
                ftsAudit: { status: "verified" },
            });
        });
    });

    it("recreating an FTS table invalidates old proof without running an inline audit", async () => {
        await fixture(async (db) => {
            await db.prepare("DROP TABLE article_search").run();
            const reopened = await openPages(db, true);
            expect(await readFtsAudit(db, true)).toEqual({ status: "unverified" });
            expect(await reopened.getArticleIndexHealth()).toMatchObject({ fts: "degraded" });
            expect((await reopened.searchArticles(query)).items).toHaveLength(2);
        });
    });
});
