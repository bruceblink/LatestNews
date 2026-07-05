import type { SourceID } from "@shared/types";
import type { SourceHealthSummary, SourceHealthSnapshot } from "@shared/source-health-types";

import { it, expect, describe } from "vitest";

import { normalizeHealthSourcesLimit, createSourceHealthSourcesResponse } from "../shared/source-health-api";

const NOW = Date.parse("2026-07-05T08:00:00.000Z");

function createSnapshot(input: {
    id: SourceID;
    name: string;
    status: SourceHealthSnapshot["status"];
    cacheDegraded?: boolean;
}): SourceHealthSnapshot {
    return {
        id: input.id,
        name: input.name,
        status: input.status,
        cacheDegraded: input.cacheDegraded ?? false,
        successCount: input.status === "healthy" ? 1 : 0,
        errorCount: input.status === "failing" ? 1 : 0,
        consecutiveFailures: input.status === "failing" ? 1 : 0,
        recentEvents: [],
    };
}

function createSummary(): SourceHealthSummary {
    const sources = [
        createSnapshot({
            id: "weibo" as SourceID,
            name: "微博",
            status: "failing",
            cacheDegraded: true,
        }),
        createSnapshot({
            id: "jin10" as SourceID,
            name: "金十数据",
            status: "healthy",
        }),
        createSnapshot({
            id: "seebug" as SourceID,
            name: "Seebug Paper",
            status: "idle",
        }),
    ];

    return {
        updatedAt: NOW,
        total: sources.length,
        healthy: 1,
        failing: 1,
        idle: 1,
        cacheDegraded: 1,
        sources,
    };
}

describe("source health sources API", () => {
    it("returns a versioned envelope with summary counters", () => {
        const response = createSourceHealthSourcesResponse(createSummary());

        expect(response.meta).toEqual({
            generatedAt: NOW,
            totalSourceCount: 3,
            returnedSourceCount: 3,
            healthyCount: 1,
            failingCount: 1,
            idleCount: 1,
            cacheDegradedCount: 1,
            filters: {
                status: "all",
            },
        });
        expect(response.errors).toEqual([]);
        expect(response.data.map((source) => source.id)).toEqual(["weibo", "jin10", "seebug"]);
    });

    it("filters by status and keyword before applying limit", () => {
        const response = createSourceHealthSourcesResponse(createSummary(), {
            keyword: "微博",
            status: "cache-degraded",
            limit: 1,
        });

        expect(response.data.map((source) => source.id)).toEqual(["weibo"]);
        expect(response.meta.returnedSourceCount).toBe(1);
        expect(response.meta.filters).toEqual({
            keyword: "微博",
            status: "cache-degraded",
            limit: 1,
        });
    });

    it("normalizes limit values with a max guard", () => {
        expect(normalizeHealthSourcesLimit("20")).toBe(20);
        expect(normalizeHealthSourcesLimit(600, 500)).toBe(500);
        expect(normalizeHealthSourcesLimit("0")).toBeUndefined();
        expect(normalizeHealthSourcesLimit("bad")).toBeUndefined();
    });
});
