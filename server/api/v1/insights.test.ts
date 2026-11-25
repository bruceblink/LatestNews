import type { NewsInsightsResponse } from "@shared/source-api";

import { createApp } from "h3";
import { createDatabase } from "db0";
import sqliteConnector from "db0/connectors/better-sqlite3";
import { it, vi, expect, afterAll, describe, beforeEach } from "vitest";

import insightsHandler from "./insights.post";
import { getCacheTable } from "../../database/cache";
import { assignReviewedEvent } from "../../database/article-event-governance";

const { getDatabase, fetchSourceItems, hasSourceGetter } = vi.hoisted(() => ({
    getDatabase: vi.fn(),
    fetchSourceItems: vi.fn(),
    hasSourceGetter: vi.fn(),
}));

vi.mock("nitro/database", () => ({ useDatabase: getDatabase }));
vi.mock("#/utils/source-fetch", () => ({ fetchSourceItems, hasSourceGetter }));

const app = createApp();
app.post("/api/v1/insights", insightsHandler);
const database = createDatabase(sqliteConnector({ name: ":memory:" }));

describe("insights API", () => {
    beforeEach(() => {
        getDatabase.mockReturnValue(database);
        hasSourceGetter.mockReturnValue(true);
        fetchSourceItems.mockResolvedValue([
            {
                id: "hackernews-1",
                title: "Cloudflare Pages insight test",
                url: "https://example.test/insight",
                pubDate: Date.parse("2026-11-24T00:00:00.000Z"),
            },
        ]);
        vi.stubEnv("ENABLE_CACHE", "true");
        vi.stubEnv("INIT_TABLE", "true");
    });

    afterAll(async () => {
        await database.dispose();
    });

    it("returns insights without settling D1 work after the request", async () => {
        const response = await app.request("/api/v1/insights", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                sources: ["hackernews"],
                hotLimit: 12,
                topicLimit: 8,
                wordLimit: 28,
                trendLimit: 10,
                trendWindow: "24h",
                minTopicItems: 2,
                readUrls: [],
                hiddenUrls: [],
            }),
        });

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
            data: { itemCount: 1 },
            meta: { requestedSourceCount: 1, resolvedSourceCount: 1, partial: false },
            errors: [],
        });
    });

    it("keeps display grouping read-only and resolves only approved historical memberships", async () => {
        const cache = await getCacheTable();
        const now = Date.now();
        const original = {
            id: "n4f-original",
            title: "LatestNews 0.8.4 release",
            url: "https://example.test/n4f-original",
            pubDate: now - 60_000,
        };
        const earlier = {
            ...original,
            id: "n4f-earlier",
            url: "https://example.test/n4f-earlier",
            pubDate: now - 3_600_000,
        };
        await cache!.set("hackernews", [original]);

        const request = async (sources: string[], hiddenUrls: string[] = []) => {
            const response = await app.request("/api/v1/insights", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ sources, minTopicItems: 1, hiddenUrls }),
            });
            expect(response.status).toBe(200);
            return ((await response.json()) as NewsInsightsResponse).data.topicEvents;
        };

        const first = await request(["hackernews"]);
        expect(first).toHaveLength(1);
        expect(first[0]).toMatchObject({
            identityStatus: "candidate",
            eventId: expect.stringMatching(/^candidate-v2-/),
        });
        expect(await database.prepare("SELECT event_id FROM articles WHERE canonical_url=?").get(original.url)).toEqual(
            { event_id: null }
        );
        const reviewed = await assignReviewedEvent(database, {
            urls: [original.url],
            actor: "reviewer",
            evidence: "isolated fixture",
        });
        await cache!.set("weibo", [earlier]);

        const expanded = await request(["hackernews", "weibo"]);
        expect(expanded).toHaveLength(1);
        expect(expanded[0]).toMatchObject({
            identityStatus: "partial",
            eventId: expect.stringMatching(/^candidate-v2-/),
            itemCount: 2,
        });
        expect(await database.prepare("SELECT event_id FROM articles WHERE canonical_url=?").get(earlier.url)).toEqual({
            event_id: null,
        });
        expect((await request(["weibo"]))[0].identityStatus).toBe("candidate");
        await assignReviewedEvent(database, {
            urls: [earlier.url],
            eventId: reviewed.eventId,
            actor: "reviewer",
            evidence: "isolated fixture",
        });
        expect((await request(["hackernews", "weibo"]))[0]).toMatchObject({
            identityStatus: "registered",
            eventId: reviewed.eventId,
        });
        expect(expanded[0].id).not.toBe(first[0].id);

        const partial = await request(["weibo"]);
        const hidden = await request(["hackernews", "weibo"], [original.url]);
        expect(partial[0].eventId).toBe(reviewed.eventId);
        expect(hidden[0].eventId).toBe(reviewed.eventId);

        const indexed = await cache!.searchArticles({ query: "LatestNews" });
        expect(indexed.items).toHaveLength(2);
        expect(indexed.items.map((item) => item.eventId)).toEqual([reviewed.eventId, reviewed.eventId]);
    });

    it("returns insights if event reconciliation fails", async () => {
        const cache = await getCacheTable();
        await cache!.set("hackernews", [
            { id: "n4f-failure", title: "Failure test", url: "https://example.test/n4f-failure" },
        ]);
        const prepare = database.prepare.bind(database);
        const spy = vi.spyOn(database, "prepare").mockImplementation((sql) => {
            if (sql.includes("WITH members AS")) throw new Error("Event index unavailable");
            return prepare(sql);
        });
        try {
            const response = await app.request("/api/v1/insights", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ sources: ["hackernews"], minTopicItems: 1 }),
            });
            expect(response.status).toBe(200);
            expect(await response.json()).toMatchObject({
                data: {
                    topicEvents: [
                        expect.objectContaining({
                            eventId: expect.stringMatching(/^candidate-v2-/),
                            identityStatus: "unavailable",
                        }),
                    ],
                },
                errors: [],
            });
        } finally {
            spy.mockRestore();
        }
    });
});
