import { createDatabase } from "db0";
import { it, expect, describe } from "vitest";
import sqliteConnector from "db0/connectors/better-sqlite3";

import { ArticleIndex } from "./article-index";
import { reconcileArticleEventId } from "./article-event-identity";
import { initArticleEventRegistry } from "./article-event-registry";

describe("article event registry", () => {
    it("backfills legacy IDs idempotently and records new assignments without rewriting existing IDs", async () => {
        const db = createDatabase(sqliteConnector({ name: ":memory:" }));
        try {
            const index = new ArticleIndex(db);
            await index.init();
            // Reproduce the schema before N4-G.
            await db.prepare("DROP TRIGGER trg_articles_event_insert").run();
            await db.prepare("DROP TRIGGER trg_articles_event_update").run();
            await db.prepare("DROP TABLE news_events").run();

            const older = { id: "old", title: "Old report", url: "https://example.test/old" };
            const newer = { id: "new", title: "New report", url: "https://example.test/new" };
            await index.upsertSourceItems("weibo", [older, newer]);
            await reconcileArticleEventId(db, [older.url], "event-legacy");

            await initArticleEventRegistry(db);
            const first = await index.getEvent("event-legacy", { limit: 30 });
            expect(first).toMatchObject({
                status: "ok",
                registeredAt: expect.any(Number),
                items: [expect.objectContaining({ eventId: "event-legacy", title: "Old report" })],
            });
            await initArticleEventRegistry(db);
            expect(await index.getEvent("event-legacy", { limit: 30 })).toEqual(first);

            await expect(reconcileArticleEventId(db, [older.url, newer.url], "event-different")).resolves.toBe(
                "event-legacy"
            );
            const expanded = await index.getEvent("event-legacy", { limit: 30 });
            expect(expanded).toMatchObject({
                status: "ok",
                items: expect.arrayContaining([
                    expect.objectContaining({ title: "Old report", eventId: "event-legacy" }),
                    expect.objectContaining({ title: "New report", eventId: "event-legacy" }),
                ]),
            });
            expect(await index.getEvent("event-different", { limit: 30 })).toEqual({ status: "not-found" });

            const fresh = { id: "fresh", title: "Different event", url: "https://example.test/fresh" };
            await index.upsertSourceItems("v2ex", [fresh]);
            await reconcileArticleEventId(db, [fresh.url], "event-new");
            expect(await index.getEvent("event-new", { limit: 30 })).toMatchObject({
                status: "ok",
                items: [expect.objectContaining({ eventId: "event-new", title: "Different event" })],
            });

            const missing = await reconcileArticleEventId(db, ["https://example.test/missing"], "event-provisional");
            expect(missing).toBe("event-provisional");
            expect(await index.getEvent(missing, { limit: 30 })).toEqual({ status: "not-found" });
            expect(await db.prepare("SELECT count(*) AS count FROM news_events").get()).toMatchObject({ count: 2 });
        } finally {
            await db.dispose();
        }
    });
    it("does not report an unbackfilled legacy membership as a missing event", async () => {
        const db = createDatabase(sqliteConnector({ name: ":memory:" }));
        try {
            const index = new ArticleIndex(db);
            await index.init();
            const item = { id: "unbackfilled", title: "Legacy", url: "https://example.test/legacy" };
            await index.upsertSourceItems("weibo", [item]);
            await reconcileArticleEventId(db, [item.url], "event-legacy");
            await db.prepare("DELETE FROM news_events WHERE event_id = ?").run("event-legacy");
            expect(await index.getEvent("event-legacy", { limit: 30 })).toEqual({ status: "unavailable" });
            await initArticleEventRegistry(db);
            expect(await new ArticleIndex(db).getEvent("event-legacy", { limit: 30 })).toMatchObject({
                status: "ok",
                items: [expect.objectContaining({ eventId: "event-legacy" })],
            });
        } finally {
            await db.dispose();
        }
    });

    it("keeps existing article persistence available when registry initialization fails", async () => {
        const db = createDatabase(sqliteConnector({ name: ":memory:" }));
        try {
            const failingDatabase = {
                ...db,
                prepare(sql: string) {
                    if (sql.includes("CREATE TABLE IF NOT EXISTS news_events"))
                        throw new Error("Registry initialization failed");
                    return db.prepare(sql);
                },
            } as unknown as typeof db;
            const index = new ArticleIndex(failingDatabase);
            await index.init();
            const item = { id: "fallback", title: "Fallback article", url: "https://example.test/fallback" };
            await index.upsertSourceItems("weibo", [item]);
            await expect(reconcileArticleEventId(db, [item.url], "event-fallback")).resolves.toBe("event-fallback");
            expect(await index.getEvent("event-fallback", { limit: 30 })).toEqual({ status: "unavailable" });
            expect(await index.search({ query: "Fallback" })).toMatchObject({
                status: "ok",
                items: [expect.objectContaining({ eventId: "event-fallback" })],
            });
        } finally {
            await db.dispose();
        }
    });
});
