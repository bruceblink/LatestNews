import type { SourceID, SourceResponse } from "@shared/types";

import { it, vi, expect, describe } from "vitest";

import { resolveNewsInsights } from "../server/utils/resolve-news-insights";

const NOW = Date.parse("2026-07-05T08:00:00.000Z");

function createResponseItems(id: SourceID): SourceResponse["items"] {
    return [
        {
            id: `${id}-1`,
            title: `${id} OpenAI GPT-5 update`,
            url: `https://example.com/${id}/gpt5`,
            pubDate: NOW - 60 * 1000,
        },
    ];
}

describe("resolveNewsInsights", () => {
    it("returns an envelope with insight data and partial metadata", async () => {
        const fetchMissing = vi.fn(async (id: SourceID) => createResponseItems(id));
        const saveCache = vi.fn(async () => undefined);

        const result = await resolveNewsInsights({
            sourceIds: ["weibo", "v2ex"] as SourceID[],
            cacheEntries: [
                {
                    id: "weibo" as SourceID,
                    items: createResponseItems("weibo" as SourceID),
                    updated: NOW,
                },
            ],
            fetchMissing,
            saveCache,
            now: NOW,
            insightOptions: {
                hotLimit: 1,
                wordLimit: 5,
                hiddenUrls: ["https://example.com/weibo/gpt5"],
            },
        });

        expect(result.meta).toEqual({
            generatedAt: NOW,
            requestedSourceCount: 2,
            resolvedSourceCount: 2,
            partial: false,
            omittedSourceIds: [],
        });
        expect(result.errors).toEqual([]);
        expect(result.data.generatedAt).toBe(NOW);
        expect(result.data.itemCount).toBe(1);
        expect(result.data.hotRankings).toHaveLength(1);
        expect(result.data.hotRankings[0].sourceId).toBe("v2ex");
        expect(fetchMissing).toHaveBeenCalledWith("v2ex");
        expect(saveCache).toHaveBeenCalledWith("v2ex", expect.any(Array));
    });

    it("keeps successful sources and reports failed source ids", async () => {
        const onFetchError = vi.fn();

        const result = await resolveNewsInsights({
            sourceIds: ["weibo", "v2ex"] as SourceID[],
            invalidSourceIds: ["missing-source"],
            cacheEntries: [],
            fetchMissing: async (id: SourceID) => {
                if (id === "weibo") throw new Error("source failed");
                return createResponseItems(id);
            },
            saveCache: async () => undefined,
            now: NOW,
            onFetchError,
        });

        expect(result.meta).toMatchObject({
            requestedSourceCount: 2,
            resolvedSourceCount: 1,
            partial: true,
            omittedSourceIds: ["weibo"],
        });
        expect(result.errors).toEqual([
            {
                sourceId: "missing-source",
                message: "Invalid source id",
            },
            {
                sourceId: "weibo",
                message: "source failed",
            },
        ]);
        expect(result.data.sourceCount).toBe(1);
        expect(onFetchError).toHaveBeenCalledWith(expect.any(Error), "weibo");
    });
});
