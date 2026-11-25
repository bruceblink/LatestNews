import { createApp } from "h3";
import { createDatabase } from "db0";
import sqliteConnector from "db0/connectors/better-sqlite3";
import { it, vi, expect, afterAll, describe, beforeEach } from "vitest";

import searchHandler from "./search.get";
import { getCacheTable } from "../../../database/cache";

const { getDatabase } = vi.hoisted(() => ({ getDatabase: vi.fn() }));
vi.mock("nitro/database", () => ({ useDatabase: getDatabase }));

const app = createApp();
app.get("/v1/articles/search", searchHandler);
const database = createDatabase(sqliteConnector({ name: ":memory:" }));

describe("article search API", () => {
    beforeEach(async () => {
        vi.stubEnv("ENABLE_CACHE", "true");
        vi.stubEnv("INIT_TABLE", "true");
        getDatabase.mockReturnValue(database);
        const cache = await getCacheTable();
        await cache!.set("weibo", [{ id: "article-1", title: "OpenAI GPT-5 发布", url: "https://example.com/gpt5" }]);
    });

    afterAll(async () => {
        await database.dispose();
    });

    it("returns indexed historical articles", async () => {
        const response = await app.request("/v1/articles/search?q=GPT-5");

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
            data: {
                status: "ok",
                searchMode: "fts",
                query: "GPT-5",
                items: [expect.objectContaining({ title: "OpenAI GPT-5 发布" })],
            },
            meta: { itemCount: 1, limit: 30 },
        });
    });

    it("returns separated mixed-language title terms through the v1 contract", async () => {
        const cache = await getCacheTable();
        await cache!.set("v2ex", [
            { id: "channel-1", title: "AI 频道", url: "https://example.com/channel-1" },
            { id: "channel-2", title: "AI 个性化电视频道", url: "https://example.com/channel-2" },
        ]);
        const response = await app.request("/v1/articles/search?q=" + encodeURIComponent("AI 频道") + "&source=v2ex");
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
            data: {
                searchMode: "like",
                items: [
                    expect.objectContaining({ item: expect.objectContaining({ id: "channel-1" }) }),
                    expect.objectContaining({ item: expect.objectContaining({ id: "channel-2" }) }),
                ],
            },
            meta: { itemCount: 2, sourceId: "v2ex" },
        });
    });

    it("requires a valid time and excludes undated articles when since is specified", async () => {
        const cache = await getCacheTable();
        const now = 1795550000000;
        await cache!.set("v2ex", [
            {
                id: "time-seconds",
                title: "Timestamp fixture",
                url: "https://example.test/time-seconds",
                pubDate: now / 1000,
            },
            {
                id: "time-unknown",
                title: "Timestamp fixture",
                url: "https://example.test/time-unknown",
                pubDate: "unknown",
            },
        ]);
        const response = await app.request("/v1/articles/search?q=Timestamp&since=" + now / 1000);
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
            data: {
                items: [
                    expect.objectContaining({
                        publishedAt: now,
                        item: expect.objectContaining({ id: "time-seconds" }),
                    }),
                ],
            },
            meta: { since: now, itemCount: 1 },
        });
        expect((await app.request("/v1/articles/search?q=Timestamp&since=2026-11-25T12:00:00")).status).toBe(400);
    });

    it("rejects a query exceeding 256 UTF-16 code units", async () => {
        expect((await app.request("/v1/articles/search?q=" + "x".repeat(257))).status).toBe(400);
    });

    it("rejects an empty query", async () => {
        expect((await app.request("/v1/articles/search?q=")).status).toBe(400);
    });
});
