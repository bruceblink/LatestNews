import { it, expect, describe } from "vitest";

import { sourceQualityWatchlist } from "../shared/source-quality-watchlist";
import { createSourceQualityWindowReport } from "../shared/source-quality-window";

import type { SourceQualitySampleRecord } from "../shared/source-quality-sampling";

function sample(overrides: Partial<SourceQualitySampleRecord> = {}): SourceQualitySampleRecord {
    return {
        sampledAt: 1_000,
        origin: "https://news.example.com",
        sourceId: "freebuf",
        kind: "rss",
        purpose: "RSS adapter",
        durationMs: 20,
        status: "success",
        itemCount: 2,
        freshnessMs: 100,
        ...overrides,
    };
}

describe("source quality window", () => {
    it("aggregates success, non-empty, and freshness metrics", () => {
        const report = createSourceQualityWindowReport(
            [
                sample({ sampledAt: 1_000, freshnessMs: 100 }),
                sample({ sampledAt: 2_000, status: "empty", itemCount: 0, freshnessMs: 200 }),
                sample({ sampledAt: 3_000, status: "error", itemCount: 0, freshnessMs: 300 }),
            ],
            { generatedAt: 4_000 }
        );

        expect(report).toMatchObject({
            generatedAt: 4_000,
            sampleCount: 3,
            origins: ["https://news.example.com"],
            sources: [
                {
                    sourceId: "freebuf",
                    sampleCount: 3,
                    successfulSampleCount: 2,
                    failedSampleCount: 1,
                    nonEmptySampleCount: 1,
                    emptySampleCount: 2,
                    successRate: 2 / 3,
                    nonEmptyRate: 1 / 3,
                    freshnessP50Ms: 200,
                    freshnessP95Ms: 300,
                    earliestSampledAt: 1_000,
                    latestSampledAt: 3_000,
                    observationDurationMs: 2_000,
                },
            ],
        });
    });

    it("keeps unsampled watchlist sources visible for a known origin", () => {
        const report = createSourceQualityWindowReport([sample()], {
            expectedSources: sourceQualityWatchlist,
        });

        expect(report.sources).toHaveLength(sourceQualityWatchlist.length);
        expect(report.sources.find((source) => source.sourceId === "juejin")).toMatchObject({
            origin: "https://news.example.com",
            sampleCount: 0,
            purpose: "JSON adapter",
        });
    });

    it("filters by normalized origin and inclusive timestamps before aggregation", () => {
        const report = createSourceQualityWindowReport(
            [
                sample({ sampledAt: 999, status: "error", itemCount: 0 }),
                sample({ sampledAt: 1_000 }),
                sample({ sampledAt: 2_000 }),
                sample({ sampledAt: 2_001, status: "error", itemCount: 0 }),
                sample({ sampledAt: 1_500, origin: "https://other.example.com", status: "error", itemCount: 0 }),
            ],
            { generatedAt: 3_000, origin: "https://news.example.com/", from: 1_000, to: 2_000 }
        );

        expect(report).toMatchObject({
            sampleCount: 2,
            origins: ["https://news.example.com"],
            window: { from: 1_000, to: 2_000 },
            sources: [{ sampleCount: 2, successRate: 1, observationDurationMs: 1_000 }],
        });
    });

    it("excludes future records even when the requested end is in the future", () => {
        const report = createSourceQualityWindowReport([sample(), sample({ sampledAt: 2_001 })], {
            generatedAt: 2_000,
            to: 3_000,
        });

        expect(report.sampleCount).toBe(1);
        expect(report.window.to).toBe(2_000);
        expect(() => createSourceQualityWindowReport([], { from: 2_000, to: 1_000 })).toThrow(/from <= to/);
    });

    it("keeps the requested origin and watchlist when no samples match", () => {
        const report = createSourceQualityWindowReport([sample()], {
            origin: "https://other.example.com",
            expectedSources: sourceQualityWatchlist,
        });

        expect(report.sampleCount).toBe(0);
        expect(report.sources).toHaveLength(sourceQualityWatchlist.length);
        expect(report.sources.every((source) => source.assessment.status === "insufficient-data")).toBe(true);
        expect(report.sources.every((source) => source.observationDurationMs === 0)).toBe(true);
    });

    it("deduplicates run metadata and identifies legacy records without attribution", () => {
        const run = {
            id: "2c16d6a6-4fc1-47cc-a95c-30b09173a516",
            startedAt: 500,
            commit: "a".repeat(40),
            workingTreeDirty: false,
            nodeVersion: "v24.15.0",
            intervalMs: 900_000,
            timeoutMs: 20_000,
        };
        const report = createSourceQualityWindowReport([
            sample({ run, round: 1 }),
            sample({ run, round: 2, sampledAt: 2_000 }),
            sample(),
        ]);

        expect(report.samplingRuns).toEqual([run]);
        expect(report.unattributedSampleCount).toBe(1);
    });
});
