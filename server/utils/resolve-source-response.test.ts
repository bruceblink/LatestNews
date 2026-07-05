import type { NewsItem, SourceID } from "@shared/types";

import { it, vi, expect, describe } from "vitest";

import { resolveSourceResponse } from "./resolve-source-response";

const NOW = Date.parse("2026-07-05T08:00:00.000Z");
const TTL = 30 * 60 * 1000;
const INTERVAL = 10 * 60 * 1000;

function createItems(id: SourceID): NewsItem[] {
    return [
        {
            id: `${id}-1`,
            title: `${id} title`,
            url: `https://example.com/${id}`,
        },
    ];
}

describe("resolveSourceResponse", () => {
    it("returns normal cache within the source interval", async () => {
        const fetchLatest = vi.fn(async () => createItems("weibo" as SourceID));

        const result = await resolveSourceResponse({
            id: "weibo" as SourceID,
            name: "微博",
            cache: {
                items: createItems("weibo" as SourceID),
                updated: NOW - 1_000,
            },
            latest: true,
            canRefresh: true,
            degraded: false,
            sourceInterval: INTERVAL,
            now: NOW,
            ttl: TTL,
            fetchLatest,
        });

        expect(result).toMatchObject({
            status: "cache",
            id: "weibo",
            name: "微博",
            updatedTime: NOW - 1_000,
        });
        expect(fetchLatest).not.toHaveBeenCalled();
    });

    it("marks cache returned by source health degradation", async () => {
        const result = await resolveSourceResponse({
            id: "weibo" as SourceID,
            cache: {
                items: createItems("weibo" as SourceID),
                updated: NOW - INTERVAL - 1,
            },
            latest: true,
            canRefresh: true,
            degraded: true,
            sourceInterval: INTERVAL,
            now: NOW,
            ttl: TTL,
            fetchLatest: async () => createItems("weibo" as SourceID),
        });

        expect(result.status).toBe("degraded-cache");
    });

    it("fetches and saves fresh non-empty data when refresh is allowed", async () => {
        const saveCache = vi.fn(async () => undefined);
        const items = createItems("weibo" as SourceID);

        const result = await resolveSourceResponse({
            id: "weibo" as SourceID,
            cache: {
                items: createItems("weibo" as SourceID),
                updated: NOW - TTL - 1,
            },
            latest: true,
            canRefresh: true,
            degraded: false,
            sourceInterval: INTERVAL,
            now: NOW,
            ttl: TTL,
            fetchLatest: async () => items,
            saveCache,
        });

        expect(result.status).toBe("success");
        expect(result.items).toBe(items);
        expect(result.updatedTime).toBe(NOW);
        expect(saveCache).toHaveBeenCalledWith(items);
    });

    it("returns empty when fetch succeeds with no items and no cache exists", async () => {
        const saveCache = vi.fn(async () => undefined);

        const result = await resolveSourceResponse({
            id: "weibo" as SourceID,
            latest: true,
            canRefresh: true,
            degraded: false,
            sourceInterval: INTERVAL,
            now: NOW,
            ttl: TTL,
            fetchLatest: async () => [],
            saveCache,
        });

        expect(result).toMatchObject({
            status: "empty",
            items: [],
            updatedTime: NOW,
        });
        expect(saveCache).not.toHaveBeenCalled();
    });

    it("falls back to stale cache when latest fetch fails", async () => {
        const onFetchError = vi.fn();

        const result = await resolveSourceResponse({
            id: "weibo" as SourceID,
            cache: {
                items: createItems("weibo" as SourceID),
                updated: NOW - TTL - 1,
            },
            latest: true,
            canRefresh: true,
            degraded: false,
            sourceInterval: INTERVAL,
            now: NOW,
            ttl: TTL,
            fetchLatest: async () => {
                throw new Error("temporary failure");
            },
            onFetchError,
        });

        expect(result.status).toBe("stale-cache");
        expect(result.updatedTime).toBe(NOW - TTL - 1);
        expect(onFetchError).toHaveBeenCalledWith(expect.any(Error));
    });
});
