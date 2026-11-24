import { createApp } from "h3";
import { createDatabase } from "db0";
import sqliteConnector from "db0/connectors/better-sqlite3";
import { it, vi, expect, afterAll, describe, beforeEach } from "vitest";

import insightsHandler from "./insights.post";

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
});
