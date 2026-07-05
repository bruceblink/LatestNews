import { it, expect, describe } from "vitest";

import {
    getCachedSourceResponseStatus,
    getFetchedSourceResponseStatus,
    shouldReturnCachedSourceResponse,
} from "../shared/source-response-status";

const NOW = Date.parse("2026-07-05T08:00:00.000Z");
const TTL = 30 * 60 * 1000;
const INTERVAL = 10 * 60 * 1000;

describe("source response status", () => {
    it("classifies fetched responses by item count", () => {
        expect(getFetchedSourceResponseStatus(1)).toBe("success");
        expect(getFetchedSourceResponseStatus(0)).toBe("empty");
    });

    it("classifies cache responses by age and degradation", () => {
        expect(
            getCachedSourceResponseStatus({
                cacheUpdatedAt: NOW - 1_000,
                now: NOW,
                ttl: TTL,
            })
        ).toBe("cache");
        expect(
            getCachedSourceResponseStatus({
                cacheUpdatedAt: NOW - 1_000,
                degraded: true,
                now: NOW,
                ttl: TTL,
            })
        ).toBe("degraded-cache");
        expect(
            getCachedSourceResponseStatus({
                cacheUpdatedAt: NOW - TTL - 1,
                degraded: true,
                now: NOW,
                ttl: TTL,
            })
        ).toBe("stale-cache");
    });

    it("returns cache only when policy allows skipping refresh", () => {
        expect(
            shouldReturnCachedSourceResponse({
                cacheUpdatedAt: NOW - 1_000,
                canRefresh: true,
                latest: true,
                now: NOW,
                sourceInterval: INTERVAL,
                ttl: TTL,
            })
        ).toBe(true);
        expect(
            shouldReturnCachedSourceResponse({
                cacheUpdatedAt: NOW - INTERVAL - 1,
                canRefresh: true,
                latest: true,
                now: NOW,
                sourceInterval: INTERVAL,
                ttl: TTL,
            })
        ).toBe(false);
        expect(
            shouldReturnCachedSourceResponse({
                cacheUpdatedAt: NOW - INTERVAL - 1,
                canRefresh: false,
                latest: true,
                now: NOW,
                sourceInterval: INTERVAL,
                ttl: TTL,
            })
        ).toBe(true);
    });
});
