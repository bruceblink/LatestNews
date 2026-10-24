import { it, expect, describe } from "vitest";

import { assessSourceQualityWindow } from "../shared/source-quality-policy";
import { createSourceQualityWindowReport } from "../shared/source-quality-window";

import type { SourceQualitySampleRecord } from "../shared/source-quality-sampling";

function createSource(status: SourceQualitySampleRecord["status"] = "success") {
    const report = createSourceQualityWindowReport([
        {
            sampledAt: 1_000,
            origin: "https://news.example.com",
            sourceId: "freebuf",
            kind: "rss",
            purpose: "RSS adapter",
            durationMs: 10,
            status,
            itemCount: status === "empty" ? 0 : 1,
            freshnessMs: 100,
        },
    ]);
    return report.sources[0]!;
}

describe("source quality policy", () => {
    it("keeps short windows in insufficient-data state", () => {
        const assessment = assessSourceQualityWindow(createSource());

        expect(assessment.status).toBe("insufficient-data");
        expect(assessment.reasons[0]).toContain("样本不足");
    });

    it("marks a complete healthy window as passing", () => {
        const assessment = assessSourceQualityWindow(createSource(), {
            minimumSampleCount: 1,
            minimumSuccessRate: 1,
            minimumNonEmptyRate: 1,
            maximumFreshnessP95Ms: 1_000,
        });

        expect(assessment).toEqual({ status: "passing", reasons: [] });
    });

    it("reports operational attention reasons after enough samples", () => {
        const source = createSource("error");
        const assessment = assessSourceQualityWindow(source, {
            minimumSampleCount: 1,
            minimumSuccessRate: 1,
            minimumNonEmptyRate: 1,
            maximumFreshnessP95Ms: 1_000,
        });

        expect(assessment.status).toBe("needs-attention");
        expect(assessment.reasons).toContain("成功率低于 100.0%");
    });

    it("accepts a freshness value exactly at the configured limit", () => {
        const assessment = assessSourceQualityWindow(createSource(), {
            minimumSampleCount: 1,
            minimumSuccessRate: 1,
            minimumNonEmptyRate: 1,
            maximumFreshnessP95Ms: 100,
        });

        expect(assessment).toEqual({ status: "passing", reasons: [] });
    });

    it("requires freshness data after the sample count threshold is met", () => {
        const source = createSource();
        source.freshnessP95Ms = undefined;

        const assessment = assessSourceQualityWindow(source, {
            minimumSampleCount: 1,
            minimumSuccessRate: 1,
            minimumNonEmptyRate: 1,
            maximumFreshnessP95Ms: 100,
        });

        expect(assessment.status).toBe("needs-attention");
        expect(assessment.reasons).toContain("缺少发布时间新鲜度数据");
    });
});
