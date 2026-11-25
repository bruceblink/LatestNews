import type { Database } from "db0";
import type { NewsItem } from "@shared/types";

import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabase } from "db0";
import { rm, mkdtemp } from "node:fs/promises";
import { it, expect, describe, afterEach } from "vitest";
import sqliteConnector from "db0/connectors/better-sqlite3";

import { ArticleIndex } from "./article-index";
import { assignReviewedEvent } from "./article-event-governance";

const databases: Array<Awaited<ReturnType<typeof createDatabase>> & { dispose?: () => Promise<void> }> = [];

afterEach(async () => {
    while (databases.length) await databases.pop()?.dispose?.();
});

describe("article index", () => {
    it("upserts duplicate URLs and keeps source mappings", async () => {
        const index = await createIndex();
        const first = createItem("first", "OpenAI 发布 GPT-5", "https://example.com/gpt5?utm_source=feed");
        const second = createItem("second", "OpenAI 发布 GPT-5 模型", "https://www.example.com/gpt5");

        await index.upsertSourceItems("weibo", [first]);
        await index.upsertSourceItems("v2ex", [second]);
        const result = await index.search({ query: "GPT-5" });

        expect(result.status).toBe("ok");
        expect(result.items).toHaveLength(1);
        expect(result.items[0]).toMatchObject({
            title: "OpenAI 发布 GPT-5 模型",
            sourceIds: expect.arrayContaining(["weibo", "v2ex"]),
            canonicalUrl: "https://example.com/gpt5",
        });
    });

    it("uses raw IDs and fingerprints to make repeated source writes idempotent", async () => {
        const index = await createIndex();
        const item = createItem("same-id", "Original title", "https://example.com/one");
        const changed = { ...item, title: "Updated title" };

        await index.upsertSourceItems("weibo", [item]);
        await index.upsertSourceItems("weibo", [changed]);
        const result = await index.search({ query: "Updated" });

        expect(result.items).toHaveLength(1);
        expect(result.items[0]?.item.id).toBe("same-id");
        expect(result.items[0]?.title).toBe("Updated title");
    });

    it("associates stable event IDs and rebuilds the FTS index", async () => {
        const db = createDatabase(sqliteConnector({ name: ":memory:" }));
        databases.push(db);
        const index = new ArticleIndex(db);
        await index.init();
        const item = createItem("event-item", "安全事件公告", "https://example.com/security");
        await index.upsertSourceItems("weibo", [item]);
        const approved = await assignReviewedEvent(db, {
            urls: [item.url],
            actor: "fixture",
            evidence: "fixture only",
        });
        const events = await index.resolveEventIds([
            {
                id: "legacy-topic",
                eventId: "event-v1-stable",
                title: item.title,
                canonicalUrl: item.url,
                sources: ["weibo"],
                sourceNames: ["Weibo"],
                itemCount: 1,
                keywords: ["安全"],
                items: [{ id: String(item.id), sourceId: "weibo", title: item.title, url: item.url }],
            },
        ]);

        expect(events).toMatchObject([{ id: "legacy-topic", eventId: approved.eventId, identityStatus: "registered" }]);
        expect(await index.rebuildSearchIndex()).toMatchObject({ status: "ok", indexed: 1 });
        await expect(index.search({ query: "安全" })).resolves.toMatchObject({
            status: "ok",
            items: [expect.objectContaining({ eventId: approved.eventId })],
        });
    });

    it("does not index unsafe new URLs or return unsafe legacy rows", async () => {
        const db = createDatabase(sqliteConnector({ name: ":memory:" }));
        databases.push(db);
        const index = new ArticleIndex(db);
        await index.init();
        const safe = createItem("safe", "Legacy URL boundary", "https://example.test/safe");
        const bad = createItem("bad", "Legacy URL boundary", "file:///legacy");
        expect(await index.upsertSourceItems("weibo", [safe, bad])).toEqual({ inserted: 1, updated: 0 });
        // Simulate a historical record written before the policy existed.
        await db
            .prepare(
                "INSERT INTO articles (article_key, canonical_url, title, published_at, content_fingerprint, event_id, payload, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
            )
            .run(
                "legacy-unsafe",
                bad.url,
                bad.title,
                bad.pubDate,
                "legacy-unsafe",
                "event-legacy-url",
                JSON.stringify(bad),
                1,
                1
            );
        await index.rebuildSearchIndex();
        const query = { query: "Legacy URL boundary" };
        expect((await index.search(query)).items.map((item) => item.item.id)).toEqual(["safe"]);
        expect((await index.searchLike(query)).items.map((item) => item.item.id)).toEqual(["safe"]);
        expect(await index.getEvent("event-legacy-url", { limit: 30 })).toMatchObject({ status: "ok", items: [] });
        expect(await db.prepare("SELECT payload FROM articles WHERE article_key = ?").get("legacy-unsafe")).toEqual({
            payload: JSON.stringify(bad),
        });
    });

    it("keeps article persistence available when FTS5 initialization fails", async () => {
        const database = createDatabase(sqliteConnector({ name: ":memory:" }));
        databases.push(database);
        const failingDatabase = {
            ...database,
            prepare(sql: string) {
                if (sql.includes("CREATE VIRTUAL TABLE")) throw new Error("FTS5 unavailable");
                return database.prepare(sql);
            },
        } as unknown as Database;
        const index = new ArticleIndex(failingDatabase);

        await index.init();
        await index.upsertSourceItems("weibo", [
            createItem("fallback", "Fallback article", "https://example.com/fallback"),
        ]);

        await expect(index.search({ query: "Fallback" })).resolves.toMatchObject({
            status: "ok",
            mode: "like",
            items: [expect.objectContaining({ title: "Fallback article" })],
        });
        await expect(database.prepare("SELECT count(*) AS count FROM articles").get()).resolves.toMatchObject({
            count: 1,
        });
    });

    it("rebuilds missing FTS rows after reopening a file database", async () => {
        const directory = await mkdtemp(join(tmpdir(), "latestnews-article-index-reopen-"));
        const firstDatabase = createDatabase(sqliteConnector({ cwd: directory, name: "articles" }));
        const firstIndex = new ArticleIndex(firstDatabase);
        await firstIndex.init();
        await firstIndex.upsertSourceItems("weibo", [
            createItem("reopen", "Persistent article", "https://example.com/reopen"),
        ]);
        await firstDatabase.prepare("DELETE FROM article_search").run();
        await firstDatabase.dispose();

        const reopenedDatabase = createDatabase(sqliteConnector({ cwd: directory, name: "articles" }));
        const reopenedIndex = new ArticleIndex(reopenedDatabase);
        await reopenedIndex.init();
        await expect(reopenedIndex.search({ query: "Persistent" })).resolves.toMatchObject({
            status: "ok",
            mode: "fts",
            items: [expect.objectContaining({ title: "Persistent article" })],
        });
        await reopenedDatabase.dispose();
        await rm(directory, { recursive: true, force: true });
    });

    it("returns all Han substring matches even when FTS finds an exact token", async () => {
        const index = await createIndex();
        await index.upsertSourceItems("weibo", [
            createItem("exact", "频道", "https://example.com/exact"),
            createItem("substring", "个性化电视频道", "https://example.com/substring"),
            createItem("phrase", "AI 频道", "https://example.com/phrase"),
            createItem("split", "AI 个性化电视频道", "https://example.com/split"),
        ]);
        const all = await index.search({ query: "频道" });
        expect(all.mode).toBe("like");
        expect(all.items.map((item) => item.item.id)).toEqual(
            expect.arrayContaining(["exact", "substring", "phrase", "split"])
        );
        expect(all.items[0].item.id).toBe("exact");
        expect((await index.search({ query: "AI 频道" })).items.map((item) => item.item.id)).toEqual([
            "phrase",
            "split",
        ]);
    });

    it("ranks title matches above URL matches and treats LIKE symbols literally", async () => {
        const index = await createIndex();
        await index.upsertSourceItems("weibo", [
            createItem("url", "Unrelated", "https://example.com/ai/channel"),
            createItem("title", "AI personalized channel", "https://example.com/title"),
            createItem("literal", "完成度 100%_测试", "https://example.com/literal"),
            createItem("noise", "完成度 1000测试", "https://example.com/noise"),
        ]);
        expect((await index.searchLike({ query: "AI channel" })).items.map((item) => item.item.id)).toEqual([
            "title",
            "url",
        ]);
        expect((await index.search({ query: "%_" })).items.map((item) => item.item.id)).toEqual(["literal"]);
        expect((await index.search({ query: "100%_测试" })).items.map((item) => item.item.id)).toEqual(["literal"]);
    });

    it("applies source, time and result limit before ordering and breaks ties consistently", async () => {
        const index = await createIndex();
        const date = Date.parse("2026-11-23T00:00:00Z");
        await index.upsertSourceItems("weibo", [
            { ...createItem("old", "量化 权重", "https://example.com/old"), pubDate: date - 1000 },
            createItem("a", "量化模型与权重", "https://example.com/a"),
            createItem("b", "量化模型与权重", "https://example.com/b"),
        ]);
        await index.upsertSourceItems("v2ex", [createItem("other", "量化 权重", "https://example.com/other")]);
        const query = { query: "量化 权重", sourceId: "weibo" as const, since: date, limit: 1 };
        const first = await index.search(query);
        expect(first.items).toHaveLength(1);
        expect(["a", "b"]).toContain(first.items[0].item.id);
        expect(await index.search(query)).toEqual(first);
        expect((await index.search({ ...query, limit: 10 })).items.map((item) => item.item.id).sort()).toEqual([
            "a",
            "b",
        ]);
    });

    it("reports LIKE fallback mode for Chinese short queries", async () => {
        const index = await createIndex();
        await index.upsertSourceItems("weibo", [
            createItem("security", "安全事件公告", "https://example.com/security"),
            createItem("chip", "芯片供应链更新", "https://example.com/chip"),
        ]);

        await expect(index.search({ query: "安全" })).resolves.toMatchObject({
            status: "ok",
            mode: "like",
            items: [expect.objectContaining({ title: "安全事件公告" })],
        });
        await expect(index.search({ query: "芯" })).resolves.toMatchObject({
            status: "ok",
            mode: "like",
            items: [expect.objectContaining({ title: "芯片供应链更新" })],
        });
    });
});

async function createIndex() {
    const database = createDatabase(sqliteConnector({ name: ":memory:" }));
    databases.push(database);
    const index = new ArticleIndex(database);
    await index.init();
    return index;
}

function createItem(id: string, title: string, url: string): NewsItem {
    return { id, title, url, pubDate: Date.parse("2026-11-23T00:00:00.000Z") };
}
