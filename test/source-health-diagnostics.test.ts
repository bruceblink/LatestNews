import type { SourceHealthSummary } from "@shared/source-health-types";

import { it, expect, describe } from "vitest";

import {
    formatSourceHealthDiagnostics,
    createSourceHealthDiagnosticFilename,
} from "../shared/source-health-diagnostics";

const UPDATED_AT = Date.parse("2026-07-08T12:00:00.000Z");

const summary: SourceHealthSummary = {
    updatedAt: UPDATED_AT,
    total: 4,
    healthy: 1,
    failing: 2,
    idle: 1,
    cacheDegraded: 1,
    sources: [
        {
            id: "weibo",
            name: "微博",
            status: "failing",
            successCount: 3,
            errorCount: 5,
            consecutiveFailures: 4,
            cacheDegraded: true,
            lastDurationMs: 900,
            lastErrorAt: UPDATED_AT - 10_000,
            lastErrorMessage: "HTTP 500",
            recentEvents: [
                {
                    status: "failing",
                    occurredAt: UPDATED_AT - 10_000,
                    durationMs: 900,
                    errorMessage: "HTTP 500",
                },
            ],
        },
        {
            id: "v2ex",
            name: "V2EX",
            status: "failing",
            successCount: 1,
            errorCount: 2,
            consecutiveFailures: 2,
            cacheDegraded: false,
            lastDurationMs: 400,
            lastErrorAt: UPDATED_AT - 60_000,
            lastErrorMessage: "timeout",
            recentEvents: [],
        },
        {
            id: "ithome",
            name: "IT之家",
            status: "healthy",
            successCount: 8,
            errorCount: 1,
            consecutiveFailures: 0,
            cacheDegraded: false,
            lastSuccessAt: UPDATED_AT - 20_000,
            lastItemCount: 20,
            recentEvents: [],
        },
        {
            id: "seebug",
            name: "Seebug Paper",
            status: "idle",
            successCount: 0,
            errorCount: 0,
            consecutiveFailures: 0,
            cacheDegraded: false,
            recentEvents: [],
        },
    ],
};

describe("source health diagnostics", () => {
    it("formats a deterministic diagnostics report for source health summaries", () => {
        const report = formatSourceHealthDiagnostics(summary, {
            formatTime: (time) => `time:${time}`,
            maxFailingSources: 1,
        });

        expect(report).toContain("LatestNews 数据源诊断报告");
        expect(report).toContain("生成时间：time:1783512000000");
        expect(report).toContain("总数据源：4");
        expect(report).toContain("1. 微博 (weibo)");
        expect(report).toContain("连续失败：4");
        expect(report).toContain("- 失败 · time:1783511990000 · 900 ms · HTTP 500");
        expect(report).not.toContain("V2EX");
        expect(report).toContain("## 缓存降级源");
        expect(report).toContain("1. Seebug Paper (seebug)");
        expect(report).toContain("1. IT之家 (ithome) · 成功 8 次");
    });

    it("formats empty sections when no matching source exists", () => {
        const report = formatSourceHealthDiagnostics({
            updatedAt: UPDATED_AT,
            total: 1,
            healthy: 1,
            failing: 0,
            idle: 0,
            cacheDegraded: 0,
            sources: [summary.sources[2]],
        });

        expect(report).toContain("## 异常源\n无");
        expect(report).toContain("## 缓存降级源\n无");
        expect(report).toContain("## 未采样源\n无");
    });

    it("creates filesystem-friendly diagnostic filenames", () => {
        expect(createSourceHealthDiagnosticFilename(summary)).toBe(
            "latestnews-source-health-2026-07-08T12-00-00-000Z.txt"
        );
    });
});
