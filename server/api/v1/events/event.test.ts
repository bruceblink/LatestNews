import type { NewsItem, SourceID } from "@shared/types";
import type { ArticleEventResponse } from "@shared/source-api";

import { createApp } from "h3";
import { createDatabase } from "db0";
import sqliteConnector from "db0/connectors/better-sqlite3";
import { it, vi, expect, afterAll, describe, beforeAll } from "vitest";

import eventHandler from "./[eventId].get";
import { getCacheTable } from "../../../database/cache";
import { reconcileArticleEventId } from "../../../database/article-event-identity";
import { approveArticleEventAlias } from "../../../database/article-event-aliases";

const { getDatabase } = vi.hoisted(() => ({ getDatabase: vi.fn() }));
vi.mock("nitro/database", () => ({ useDatabase: getDatabase }));

const app = createApp();
app.get("/api/v1/events/:eventId", eventHandler);
const database = createDatabase(sqliteConnector({ name: ":memory:" }));

function fixture(index: number): NewsItem {
    return {
        id: String(index),
        title: "LatestNews event fixture " + index,
        url: "https://example.test/event/" + index,
    };
}

async function register(eventId: string, items: NewsItem[], sourceId: SourceID = "weibo") {
    const cache = (await getCacheTable())!;
    await cache.set(sourceId, items);
    // Large snapshots are now replayed in bounded chunks. Event registration
    // requires all fixture articles to be persisted, not just cache commit.
    for (let pass = 0; pass < Math.ceil(items.length / 30); pass++) {
        if ((await cache.getArticleIndexHealth()).pendingIngest === 0) break;
        await cache.runArticleMaintenance();
    }
    expect(await cache.getArticleIndexHealth()).toMatchObject({ pendingIngest: 0 });
    // Fixture legacy registry IDs; the production display endpoint is read-only.
    await reconcileArticleEventId(
        database,
        items.map((item) => item.url),
        eventId
    );
    return cache;
}

async function readEvent(id: string, query = "") {
    const response = await app.request("/api/v1/events/" + id + query);
    expect(response.status).toBe(200);
    return (await response.json()) as ArticleEventResponse;
}

describe("article event history API", () => {
    beforeAll(async () => {
        vi.stubEnv("ENABLE_CACHE", "true");
        vi.stubEnv("INIT_TABLE", "true");
        getDatabase.mockReturnValue(database);
        await getCacheTable();
    });

    afterAll(async () => {
        vi.unstubAllEnvs();
        await database.dispose();
    });

    it("reads persisted members independently of source cache and paginates without duplicates", async () => {
        const items = Array.from({ length: 101 }, (_, index) => fixture(index));
        const cache = await register("event-history", items);
        // A second source reports the same article; the index must retain both source mappings.
        await cache.set("v2ex", [items[0]]);
        await cache.delete("weibo");
        await cache.delete("v2ex");

        const first = await readEvent("event-history", "?limit=100");
        expect(first.data.eventId).toBe("event-history");
        expect(first.data.registeredAt).toBeGreaterThan(0);
        expect(first.meta).toMatchObject({ itemCount: 100, limit: 100, nextCursor: expect.any(String) });
        const second = await readEvent("event-history", "?limit=100&after=" + first.meta.nextCursor);
        expect(second.meta).toMatchObject({ itemCount: 1, limit: 100 });
        expect(second.meta.nextCursor).toBeUndefined();
        expect(second.data.registeredAt).toBe(first.data.registeredAt);
        const combined = [...first.data.items, ...second.data.items];
        expect(new Set(combined.map((item) => item.articleKey)).size).toBe(101);
        expect(combined.map((item) => item.articleKey)).toEqual(combined.map((item) => item.articleKey).sort());
        expect(combined.every((item) => item.eventId === "event-history")).toBe(true);
        expect(combined.find((item) => item.item.id === items[0].id)?.sourceIds).toEqual(["v2ex", "weibo"]);
    });

    it("resolves approved aliases while preserving original article IDs", async () => {
        await register("event-alias-a", [fixture(501)]);
        await register("event-alias-b", [fixture(502)]);
        await approveArticleEventAlias(database, {
            aliasId: "event-alias-a",
            canonicalId: "event-alias-b",
            actor: "tester",
            evidence: "reviewed pair",
        });
        const result = await readEvent("event-alias-a");
        expect(result.data).toMatchObject({ eventId: "event-alias-a", canonicalEventId: "event-alias-b" });
        expect(result.data.items.map((item) => item.eventId).sort()).toEqual(["event-alias-a", "event-alias-b"]);
        expect((await readEvent("event-alias-b")).data.items).toEqual(result.data.items);
    });

    it("distinguishes missing events and invalid inputs", async () => {
        expect((await app.request("/api/v1/events/not-registered")).status).toBe(404);
        expect((await app.request("/api/v1/events/invalid%20id")).status).toBe(400);
        for (const query of ["?limit=0", "?limit=101", "?limit=1.5", "?limit=1&limit=2", "?after="]) {
            expect((await app.request("/api/v1/events/event-history" + query)).status).toBe(400);
        }
    });

    it("returns 503 for an unavailable registry without disabling article search", async () => {
        const cache = (await getCacheTable())!;
        const prepare = database.prepare.bind(database);
        const spy = vi.spyOn(database, "prepare").mockImplementation((sql) => {
            if (sql.includes("FROM news_events")) throw new Error("Registry unavailable");
            return prepare(sql);
        });
        try {
            expect((await app.request("/api/v1/events/event-history")).status).toBe(503);
            expect((await cache.searchArticles({ query: "LatestNews" })).status).toBe("ok");
        } finally {
            spy.mockRestore();
        }
    });
});
