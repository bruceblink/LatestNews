import type { SourceID, SourceResponse } from "@shared/types";

import { it, vi, expect, describe } from "vitest";

import { resolveEntireSources } from "../server/utils/resolve-entire-sources";

function createResponseItems(id: SourceID): SourceResponse["items"] {
    return [
        {
            id: `${id}-1`,
            title: `${id} title`,
            link: `https://example.com/${id}`,
            created: "2026-01-01T00:00:00.000Z",
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
                updated: Date.now() - 1000,
            },
        ];

        const fetchMissing = vi.fn(async (id: SourceID) => createResponseItems(id));
        const saveCache = vi.fn(async () => undefined);

        const result = await resolveEntireSources({
            sourceIds,
            cacheEntries,
            fetchMissing,
            saveCache,
            now: Date.now(),
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
                updated: Date.now() - 1000,
            },
        ];

        const result = await resolveEntireSources({
            sourceIds,
            cacheEntries,
            fetchMissing: async (id: SourceID) => createResponseItems(id),
            saveCache: async () => undefined,
            now: Date.now(),
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
            now: Date.now(),
            onFetchError,
        });

        expect(result).toHaveLength(1);
        expect(result[0].id).toBe("v2ex");
        expect(onFetchError).toHaveBeenCalledTimes(1);
    });
});
