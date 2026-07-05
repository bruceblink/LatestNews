import type { SourceID, SourceResponse } from "@shared/types";

import { it, vi, expect, describe } from "vitest";

import { resolveEntireSources, resolveEntireSourcesWithDiagnostics } from "../server/utils/resolve-entire-sources";

const NOW = Date.parse("2026-07-05T08:00:00.000Z");
const TTL = 30 * 60 * 1000;

function createResponseItems(id: SourceID): SourceResponse["items"] {
    return [
        {
            id: `${id}-1`,
            title: `${id} title`,
            url: `https://example.com/${id}`,
            pubDate: "2026-01-01T00:00:00.000Z",
            extra: {},
        },
    ];
}

describe("resolveEntireSources", () => {
    it("returns cached entries and backfills missing sources", async () => {
        const sourceIds: SourceID[] = ["v2ex", "weibo"];
        const cacheEntries = [
            {
                id: "v2ex" as SourceID,
                items: createResponseItems("v2ex"),
                updated: NOW - 1000,
            },
        ];

        const fetchMissing = vi.fn(async (id: SourceID) => createResponseItems(id));
        const saveCache = vi.fn(async () => undefined);

        const result = await resolveEntireSources({
            sourceIds,
            cacheEntries,
            fetchMissing,
            saveCache,
            now: NOW,
        });

        expect(result).toHaveLength(2);
        expect(result[0].id).toBe("v2ex");
        expect(result[0].status).toBe("cache");
        expect(result[1].id).toBe("weibo");
        expect(result[1].status).toBe("success");
        expect(fetchMissing).toHaveBeenCalledTimes(1);
        expect(fetchMissing).toHaveBeenCalledWith("weibo");
        expect(saveCache).toHaveBeenCalledTimes(1);
        expect(saveCache).toHaveBeenCalledWith("weibo", expect.any(Array));
    });

    it("keeps requested source order in response", async () => {
        const sourceIds: SourceID[] = ["weibo", "v2ex"];
        const cacheEntries = [
            {
                id: "v2ex" as SourceID,
                items: createResponseItems("v2ex"),
                updated: NOW - 1000,
            },
        ];

        const result = await resolveEntireSources({
            sourceIds,
            cacheEntries,
            fetchMissing: async (id: SourceID) => createResponseItems(id),
            saveCache: async () => undefined,
            now: NOW,
        });

        expect(result.map((item) => item.id)).toEqual(["weibo", "v2ex"]);
    });

    it("continues returning successful sources when one fetch fails", async () => {
        const sourceIds: SourceID[] = ["weibo", "v2ex"];
        const onFetchError = vi.fn();

        const result = await resolveEntireSources({
            sourceIds,
            cacheEntries: [],
            fetchMissing: async (id: SourceID) => {
                if (id === "weibo") throw new Error("fetch failed");
                return createResponseItems(id);
            },
            saveCache: async () => undefined,
            now: NOW,
            onFetchError,
        });

        expect(result).toHaveLength(1);
        expect(result[0].id).toBe("v2ex");
        expect(onFetchError).toHaveBeenCalledTimes(1);
        expect(onFetchError).toHaveBeenCalledWith(expect.any(Error), "weibo");
    });

    it("marks stale cache entries when they exceed the cache TTL", async () => {
        const result = await resolveEntireSources({
            sourceIds: ["weibo" as SourceID],
            cacheEntries: [
                {
                    id: "weibo" as SourceID,
                    items: createResponseItems("weibo" as SourceID),
                    updated: NOW - TTL - 1,
                },
            ],
            fetchMissing: async (id: SourceID) => createResponseItems(id),
            saveCache: async () => undefined,
            now: NOW,
        });

        expect(result[0]).toMatchObject({
            id: "weibo",
            status: "stale-cache",
            updatedTime: NOW - TTL - 1,
        });
    });

    it("returns empty responses for fetched sources without cacheable items", async () => {
        const saveCache = vi.fn(async () => undefined);

        const result = await resolveEntireSources({
            sourceIds: ["weibo" as SourceID],
            cacheEntries: [],
            fetchMissing: async () => [],
            saveCache,
            now: NOW,
        });

        expect(result).toEqual([
            {
                status: "empty",
                id: "weibo",
                name: expect.any(String),
                items: [],
                updatedTime: NOW,
            },
        ]);
        expect(saveCache).not.toHaveBeenCalled();
    });

    it("returns diagnostics for invalid and failed sources", async () => {
        const onFetchError = vi.fn();

        const result = await resolveEntireSourcesWithDiagnostics({
            sourceIds: ["weibo", "v2ex"] as SourceID[],
            invalidSourceIds: ["missing-source"],
            cacheEntries: [],
            fetchMissing: async (id: SourceID) => {
                if (id === "weibo") throw new Error("fetch failed");
                return createResponseItems(id);
            },
            saveCache: async () => undefined,
            now: NOW,
            onFetchError,
        });

        expect(result.meta).toEqual({
            generatedAt: NOW,
            requestedSourceCount: 3,
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
                message: "fetch failed",
            },
        ]);
        expect(result.data.map((item) => item.id)).toEqual(["v2ex"]);
        expect(onFetchError).toHaveBeenCalledWith(expect.any(Error), "weibo");
    });
});
