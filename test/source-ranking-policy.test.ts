import type { SourceID } from "@shared/types";

import { it, expect, describe } from "vitest";

import {
    getHomeSourceScore,
    rankActiveSourcesForHome,
    type SourceHealthRankInput,
    rankFailingSourcesByPriority,
    getFailingSourcePriorityScore,
} from "../shared/source-ranking-policy";

function createSource(
    input: Partial<SourceHealthRankInput> & Pick<SourceHealthRankInput, "id">
): SourceHealthRankInput {
    return {
        status: "healthy",
        successCount: 0,
        consecutiveFailures: 0,
        ...input,
    } as SourceHealthRankInput;
}

describe("source ranking policy", () => {
    it("calculates higher home score for healthier and richer sources", () => {
        const base = createSource({ id: "v2ex" as SourceID, status: "idle", successCount: 3, lastItemCount: 1 });
        const better = createSource({ id: "weibo" as SourceID, status: "healthy", successCount: 5, lastItemCount: 4 });

        expect(getHomeSourceScore(better)).toBeGreaterThan(getHomeSourceScore(base));
    });

    it("ranks active home sources and excludes failing ones", () => {
        const sources = [
            createSource({ id: "v2ex" as SourceID, status: "healthy", successCount: 10, lastItemCount: 3 }),
            createSource({ id: "weibo" as SourceID, status: "failing", consecutiveFailures: 4 }),
            createSource({ id: "jin10" as SourceID, status: "idle", successCount: 2, lastItemCount: 2 }),
        ];

        const ranked = rankActiveSourcesForHome(sources);

        expect(ranked.map((item) => item.id)).toEqual(["v2ex", "jin10"]);
    });

    it("computes failing priority score from failure count, recency and duration", () => {
        const source = createSource({
            id: "v2ex" as SourceID,
            status: "failing",
            consecutiveFailures: 3,
            lastErrorAt: 1_710_000_000_000,
            lastDurationMs: 500,
        });

        expect(getFailingSourcePriorityScore(source)).toBe(1_710_000_000 + 300 + 500);
    });

    it("ranks failing sources by computed priority", () => {
        const sources = [
            createSource({
                id: "v2ex" as SourceID,
                status: "failing",
                consecutiveFailures: 2,
                lastErrorAt: 1_700_000_000_000,
                lastDurationMs: 300,
            }),
            createSource({
                id: "weibo" as SourceID,
                status: "failing",
                consecutiveFailures: 4,
                lastErrorAt: 1_700_000_010_000,
                lastDurationMs: 400,
            }),
            createSource({ id: "jin10" as SourceID, status: "healthy" }),
        ];

        const ranked = rankFailingSourcesByPriority(sources);
        expect(ranked.map((item) => item.id)).toEqual(["weibo", "v2ex"]);
    });
});
