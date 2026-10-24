import type { SourceQualityWindowSummary } from "./source-quality-window";

export const defaultSourceQualityThresholds = {
    minimumSampleCount: 96,
    minimumSuccessRate: 0.9,
    minimumNonEmptyRate: 0.8,
    maximumFreshnessP95Ms: 24 * 60 * 60 * 1000,
} as const;

export interface SourceQualityThresholds {
    minimumSampleCount: number;
    minimumSuccessRate: number;
    minimumNonEmptyRate: number;
    maximumFreshnessP95Ms: number;
}

export type SourceQualityAssessmentStatus = "passing" | "insufficient-data" | "needs-attention";

export interface SourceQualityAssessment {
    status: SourceQualityAssessmentStatus;
    reasons: string[];
}

/** Evaluate one source window against provisional operational thresholds. */
export function assessSourceQualityWindow(
    source: Omit<SourceQualityWindowSummary, "assessment">,
    thresholds: SourceQualityThresholds = defaultSourceQualityThresholds
): SourceQualityAssessment {
    const reasons: string[] = [];
    if (source.sampleCount < thresholds.minimumSampleCount) {
        reasons.push(`样本不足（需要 ${thresholds.minimumSampleCount}，当前 ${source.sampleCount}）`);
    }
    if (source.successRate === undefined || source.successRate < thresholds.minimumSuccessRate) {
        reasons.push(`成功率低于 ${(thresholds.minimumSuccessRate * 100).toFixed(1)}%`);
    }
    if (source.nonEmptyRate === undefined || source.nonEmptyRate < thresholds.minimumNonEmptyRate) {
        reasons.push(`非空率低于 ${(thresholds.minimumNonEmptyRate * 100).toFixed(1)}%`);
    }
    if (source.freshnessP95Ms === undefined) {
        reasons.push("缺少发布时间新鲜度数据");
    } else if (source.freshnessP95Ms > thresholds.maximumFreshnessP95Ms) {
        reasons.push(`P95 新鲜度超过 ${formatDuration(thresholds.maximumFreshnessP95Ms)}`);
    }

    if (source.sampleCount < thresholds.minimumSampleCount) {
        return { status: "insufficient-data", reasons };
    }
    return reasons.length ? { status: "needs-attention", reasons } : { status: "passing", reasons: [] };
}

function formatDuration(durationMs: number) {
    if (durationMs >= 24 * 60 * 60 * 1000) return `${Math.round(durationMs / (24 * 60 * 60 * 1000))} 天`;
    if (durationMs >= 60 * 60 * 1000) return `${Math.round(durationMs / (60 * 60 * 1000))} 小时`;
    return `${Math.round(durationMs / 60_000)} 分钟`;
}
