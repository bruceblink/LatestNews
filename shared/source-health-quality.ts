import type { SourceHealthSnapshot } from "./source-health-types";

export interface SourceHealthQualityMetrics {
    sampleCount: number;
    successRate?: number;
    validItemRate?: number;
    duplicateRate?: number;
    publicationCompleteness?: number;
    rawItemCount: number;
    validItemCount: number;
    invalidItemCount: number;
    duplicateItemCount: number;
    publishedItemCount: number;
    emptyResultCount: number;
    lastEmptyReason?: string;
    lastFreshnessMs?: number;
}

/** Convert cumulative counters into rates while leaving unsampled values unknown. */
export function getSourceHealthQualityMetrics(source: SourceHealthSnapshot): SourceHealthQualityMetrics {
    const quality = source.quality;
    const sampleCount = source.successCount + source.errorCount;
    const rawItemCount = quality?.rawItemCount ?? 0;
    const validItemCount = quality?.validItemCount ?? 0;

    return {
        sampleCount,
        ...(sampleCount > 0 ? { successRate: source.successCount / sampleCount } : {}),
        ...(rawItemCount > 0 ? { validItemRate: validItemCount / rawItemCount } : {}),
        ...(rawItemCount > 0 ? { duplicateRate: (quality?.duplicateItemCount ?? 0) / rawItemCount } : {}),
        ...(validItemCount > 0 ? { publicationCompleteness: (quality?.publishedItemCount ?? 0) / validItemCount } : {}),
        rawItemCount,
        validItemCount,
        invalidItemCount: quality?.invalidItemCount ?? 0,
        duplicateItemCount: quality?.duplicateItemCount ?? 0,
        publishedItemCount: quality?.publishedItemCount ?? 0,
        emptyResultCount: quality?.emptyResultCount ?? 0,
        ...(quality?.lastEmptyReason ? { lastEmptyReason: quality.lastEmptyReason } : {}),
        ...(quality?.lastFreshnessMs !== undefined ? { lastFreshnessMs: quality.lastFreshnessMs } : {}),
    };
}

export function formatSourceHealthPercent(value: number | undefined) {
    return value === undefined ? "未采样" : `${(value * 100).toFixed(1)}%`;
}

export function formatSourceHealthFreshness(value: number | undefined) {
    if (value === undefined) return "未知";
    if (value < 60_000) return `${Math.round(value / 1000)} 秒`;
    if (value < 3_600_000) return `${Math.round(value / 60_000)} 分钟`;
    return `${(value / 3_600_000).toFixed(1)} 小时`;
}
