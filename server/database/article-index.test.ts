import type { Database } from "db0";
import type { NewsItem } from "@shared/types";

import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabase } from "db0";
import { rm, mkdtemp } from "node:fs/promises";
import { it, expect, describe, afterEach } from "vitest";
import sqliteConnector from "db0/connectors/better-sqlite3";

import { ArticleIndex } from "./article-index";

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
        const index = await createIndex();
        const item = createItem("event-item", "安全事件公告", "https://example.com/security");
        await index.upsertSourceItems("weibo", [item]);
        const updated = await index.updateEventIds([
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

        expect(updated).toBe(1);
        expect(await index.rebuildSearchIndex()).toMatchObject({ status: "ok", indexed: 1 });
        await expect(index.search({ query: "安全" })).resolves.toMatchObject({
            status: "ok",
            items: [expect.objectContaining({ eventId: "event-v1-stable" })],
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

        await expect(index.search({ query: "Fallback" })).resolves.toEqual({
            status: "unavailable",
            mode: "unavailable",
            items: [],
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
