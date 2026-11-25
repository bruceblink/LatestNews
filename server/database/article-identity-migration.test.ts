import { createDatabase } from "db0";
import { createHash } from "node:crypto";
import { it, expect, describe } from "vitest";
import { articleTimestamp } from "@shared/article-time";
import sqliteConnector from "db0/connectors/better-sqlite3";

import { ArticleIndex } from "./article-index";
import { reconcileArticleEventId } from "./article-event-identity";

const now = 1795550000000;
const article = (id: string, suffix: string, pubDate: string | number | undefined = now) => ({
    id,
    title: "Identity audit " + id,
    url: "https://example.test/" + suffix,
    pubDate,
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

describe("N4-L1 article identity and atomic writes", () => {
    it("keeps both URLs that collided under the previous 32-bit hash, and preserves existing keys", async () => {
        await fixture(async (db, index) => {
            const a = article("a", "Aa");
            const b = article("b", "BB");
            await db
                .prepare("INSERT INTO articles VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
                .run("article-l2jxre", a.url, a.title, now, "old", "event-old", JSON.stringify(a), now, now);
            await db
                .prepare("INSERT INTO article_sources VALUES (?, ?, ?, ?, ?)")
                .run("article-l2jxre", "weibo", a.id, now, now);
            await index.upsertSourceItems("weibo", [a]);
            await index.upsertSourceItems("v2ex", [b]);
            expect((await index.searchLike({ query: "Identity audit" })).items).toHaveLength(2);
            expect(
                await db.prepare("SELECT article_key,event_id FROM articles WHERE canonical_url=?").get(a.url)
            ).toEqual({ article_key: "article-l2jxre", event_id: "event-old" });
            expect(
                await db.prepare("SELECT article_key,event_id FROM articles WHERE canonical_url=?").get(b.url)
            ).toMatchObject({ article_key: expect.stringMatching(/^article-v2-/), event_id: null });
        });
    });

    it("does not treat a colliding candidate key or fingerprint as equivalent URL", async () => {
        await fixture(async (db, index) => {
            const a = article("a", "different"),
                b = article("b", "target");
            const candidate = "article-v2-" + createHash("sha256").update(b.url).digest("hex");
            await db
                .prepare("INSERT INTO articles VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
                .run(candidate, a.url, a.title, now, "collision", null, JSON.stringify(a), now, now);
            await index.upsertSourceItems("weibo", [b]);
            const result = await index.searchLike({ query: "Identity audit" });
            expect(result.items).toHaveLength(2);
            expect(result.items.find((x) => x.item.id === "b")?.articleKey).not.toBe(candidate);
            expect(result.items.find((x) => x.item.id === "a")?.canonicalUrl).toBe(a.url);
        });
    });

    it("atomically retains both concurrent source mappings and a single FTS row", async () => {
        await fixture(async (db, index) => {
            const a = article("first", "same"),
                b = article("second", "same");
            const results = await Promise.all([
                index.upsertSourceItems("weibo", [a]),
                index.upsertSourceItems("v2ex", [b]),
            ]);
            expect(results.reduce((sum, result) => sum + result.inserted, 0)).toBe(1);
            expect(results.reduce((sum, result) => sum + result.updated, 0)).toBe(1);
            const found = await index.search({ query: "Identity audit" });
            expect(found.items).toHaveLength(1);
            expect(found.items[0].sourceIds).toEqual(["v2ex", "weibo"]);
            expect(await db.prepare("SELECT count(*) AS count FROM article_search").get()).toEqual({ count: 1 });
        });
    });

    it("rolls back article inserts and updates when a source association cannot be saved", async () => {
        await fixture(async (db, index) => {
            const a = article("a", "existing");
            await index.upsertSourceItems("weibo", [a]);
            await reconcileArticleEventId(db, [a.url], "event-existing");
            await db
                .prepare(
                    "CREATE TRIGGER fail_source BEFORE INSERT ON article_sources WHEN NEW.source_id='v2ex' BEGIN SELECT RAISE(ABORT,'fixture failure'); END"
                )
                .run();
            await expect(index.upsertSourceItems("v2ex", [{ ...a, title: "Failed change" }])).rejects.toThrow();
            await expect(index.upsertSourceItems("v2ex", [article("new", "new")])).rejects.toThrow();
            expect(await db.prepare("SELECT title,event_id FROM articles").all()).toEqual([
                { title: a.title, event_id: "event-existing" },
            ]);
            expect(await db.prepare("SELECT source_id FROM article_sources").all()).toEqual([{ source_id: "weibo" }]);
        });
    });

    it("does not overwrite old events when a source reuses an ID for a different URL", async () => {
        await fixture(async (db, index) => {
            const a = article("same", "old"),
                b = article("same", "new");
            await index.upsertSourceItems("weibo", [a]);
            const old = (await index.searchLike({ query: "Identity audit" })).items[0];
            await reconcileArticleEventId(db, [a.url], "event-old");
            await index.upsertSourceItems("weibo", [b]);
            await index.upsertSourceItems("weibo", [{ ...b, id: "changed" }]);
            const items = (await index.searchLike({ query: "Identity audit" })).items;
            expect(items).toHaveLength(2);
            expect(items.find((x) => x.canonicalUrl === a.url)).toMatchObject({
                articleKey: old.articleKey,
                eventId: "event-old",
                sourceIds: ["weibo"],
            });
            expect(items.find((x) => x.canonicalUrl === b.url)).toMatchObject({
                item: { id: "changed" },
                sourceIds: ["weibo"],
            });
            expect(await db.prepare("SELECT count(*) AS count FROM article_sources").get()).toEqual({ count: 2 });
        });
    });

    it("stores milliseconds and excludes unknown timestamps from explicit since filters", async () => {
        await fixture(async (db, index) => {
            const items = [
                article("sec", "sec", now / 1000),
                article("ms", "ms", now),
                article("iso", "iso", new Date(now).toISOString()),
                article("offset", "offset", "2026-11-25T21:00:00+08:00"),
                article("old", "old", now - 86400000),
                article("bad", "bad", "unknown"),
                { ...article("missing", "missing"), pubDate: undefined },
                article("local", "local", "2026-11-25T12:00:00"),
            ];
            await index.upsertSourceItems("weibo", items);
            for (const result of [
                await index.search({ query: "Identity audit", since: now - 3600000 }),
                await index.searchLike({ query: "Identity audit", since: now - 3600000 }),
            ]) {
                expect(result.items.map((x) => x.item.id).sort()).toEqual(["iso", "ms", "offset", "sec"]);
                expect(result.items.every((x) => typeof x.publishedAt === "number")).toBe(true);
            }
            expect((await index.searchLike({ query: "Identity audit" })).items).toHaveLength(8);
            expect(
                await db.prepare("SELECT published_at FROM articles WHERE canonical_url=?").get(items[5].url)
            ).toEqual({ published_at: null });
            expect(articleTimestamp("2026-11-25T12:00:00")).toBeNull();
        });
    });

    it("migrates the old source constraint and date values without changing payloads or identities", async () => {
        const db = createDatabase(sqliteConnector({ name: ":memory:" }));
        try {
            await db
                .prepare(
                    "CREATE TABLE articles (article_key TEXT PRIMARY KEY, canonical_url TEXT NOT NULL UNIQUE, title TEXT NOT NULL, published_at, content_fingerprint TEXT NOT NULL,event_id TEXT,payload TEXT NOT NULL,first_seen_at INTEGER NOT NULL,last_seen_at INTEGER NOT NULL)"
                )
                .run();
            await db
                .prepare(
                    "CREATE TABLE article_sources(article_key TEXT NOT NULL,source_id TEXT NOT NULL,raw_item_id TEXT NOT NULL,first_seen_at INTEGER NOT NULL,last_seen_at INTEGER NOT NULL,PRIMARY KEY(article_key,source_id),UNIQUE(source_id,raw_item_id))"
                )
                .run();
            const a = article("reused", "old", now / 1000);
            await db
                .prepare("INSERT INTO articles VALUES (?,?,?,?,?,?,?,?,?)")
                .run("old-key", a.url, a.title, a.pubDate, "old-fingerprint", "old-event", JSON.stringify(a), 1, 1);
            await db.prepare("INSERT INTO article_sources VALUES (?,?,?,?,?)").run("old-key", "weibo", a.id, 1, 1);
            const index = new ArticleIndex(db);
            await index.init();
            expect(await db.prepare("SELECT article_key,published_at,event_id,payload FROM articles").get()).toEqual({
                article_key: "old-key",
                published_at: now,
                event_id: "old-event",
                payload: JSON.stringify(a),
            });
            await index.upsertSourceItems("weibo", [article("reused", "new", now)]);
            await new ArticleIndex(db).init();
            expect(await db.prepare("SELECT count(*) AS count FROM article_sources").get()).toEqual({ count: 2 });
            expect(await db.prepare("SELECT count(*) AS count FROM article_schema_migrations").get()).toEqual({
                count: 1,
            });
            expect(await index.getEvent("old-event", { limit: 30 })).toMatchObject({
                status: "ok",
                items: [expect.objectContaining({ articleKey: "old-key", eventId: "old-event" })],
            });
        } finally {
            await db.dispose();
        }
    });
});
