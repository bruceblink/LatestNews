import type { NewsItem } from "@shared/types";

import { createDatabase } from "db0";
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
