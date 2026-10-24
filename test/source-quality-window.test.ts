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
                    latestSampledAt: 3_000,
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
});
