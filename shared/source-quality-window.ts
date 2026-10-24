import {
    assessSourceQualityWindow,
    type SourceQualityAssessment,
    type SourceQualityThresholds,
    defaultSourceQualityThresholds,
} from "./source-quality-policy";

import type { SourceQualityWatchlistEntry } from "./source-quality-watchlist";
import type { SourceQualitySampleRecord, SourceQualitySampleStatus } from "./source-quality-sampling";

export interface SourceQualityWindowSummary {
    origin: string;
    sourceId: string;
    kind: SourceQualityWatchlistEntry["kind"];
    purpose: string;
    sampleCount: number;
    successfulSampleCount: number;
    failedSampleCount: number;
    nonEmptySampleCount: number;
    emptySampleCount: number;
    successRate?: number;
    nonEmptyRate?: number;
    freshnessP50Ms?: number;
    freshnessP95Ms?: number;
    latestSampledAt?: number;
    assessment: SourceQualityAssessment;
}

export interface SourceQualityWindowReport {
    generatedAt: number;
    sampleCount: number;
    origins: string[];
    thresholds: SourceQualityThresholds;
    sources: SourceQualityWindowSummary[];
}

/** Aggregate append-only sample records without changing their original evidence. */
export function createSourceQualityWindowReport(
    records: readonly SourceQualitySampleRecord[],
    options: {
        generatedAt?: number;
        expectedSources?: readonly SourceQualityWatchlistEntry[];
        thresholds?: SourceQualityThresholds;
    } = {}
): SourceQualityWindowReport {
    const groups = new Map<string, { origin: string; sourceId: string; records: SourceQualitySampleRecord[] }>();
    for (const record of records) {
        const key = `${record.origin}\u0000${record.sourceId}`;
        const group = groups.get(key);
        if (group) group.records.push(record);
        else groups.set(key, { origin: record.origin, sourceId: record.sourceId, records: [record] });
    }

    for (const source of options.expectedSources ?? []) {
        for (const origin of getOrigins(records)) {
            const key = `${origin}\u0000${source.id}`;
            if (!groups.has(key)) groups.set(key, { origin, sourceId: source.id, records: [] });
        }
    }

    const sources = [...groups.values()]
        .map((group) =>
            summarizeSourceRecords(
                group.records,
                options.expectedSources,
                group.origin,
                group.sourceId,
                options.thresholds
            )
        )
        .sort((left, right) => left.origin.localeCompare(right.origin) || left.sourceId.localeCompare(right.sourceId));
    return {
        generatedAt: options.generatedAt ?? Date.now(),
        sampleCount: records.length,
        origins: getOrigins(records),
        thresholds: options.thresholds ?? defaultSourceQualityThresholds,
        sources,
    };
}

function summarizeSourceRecords(
    records: readonly SourceQualitySampleRecord[],
    expectedSources: readonly SourceQualityWatchlistEntry[] | undefined,
    origin: string,
    sourceId: string,
    thresholds?: SourceQualityThresholds
): SourceQualityWindowSummary {
    const first = records[0];
    const expected = expectedSources?.find((source) => source.id === sourceId);
    const statuses = records.map((record) => record.status);
    const successfulSampleCount = statuses.filter(isSuccessfulStatus).length;
    const nonEmptySampleCount = records.filter((record) => record.itemCount > 0).length;
    const freshness = records
        .map((record) => record.freshnessMs)
        .filter((value): value is number => value !== undefined && Number.isFinite(value) && value >= 0)
        .sort((left, right) => left - right);
    const sampleCount = records.length;
    const summary: Omit<SourceQualityWindowSummary, "assessment"> = {
        origin,
        sourceId,
        kind: first?.kind ?? expected?.kind ?? "html",
        purpose: first?.purpose ?? expected?.purpose ?? "unknown source",
        sampleCount,
        successfulSampleCount,
        failedSampleCount: sampleCount - successfulSampleCount,
        nonEmptySampleCount,
        emptySampleCount: sampleCount - nonEmptySampleCount,
        ...(sampleCount > 0 ? { successRate: successfulSampleCount / sampleCount } : {}),
        ...(sampleCount > 0 ? { nonEmptyRate: nonEmptySampleCount / sampleCount } : {}),
        ...(freshness.length
            ? { freshnessP50Ms: quantile(freshness, 0.5), freshnessP95Ms: quantile(freshness, 0.95) }
            : {}),
        ...(sampleCount ? { latestSampledAt: Math.max(...records.map((record) => record.sampledAt)) } : {}),
    };
    return { ...summary, assessment: assessSourceQualityWindow(summary, thresholds) };
}

function getOrigins(records: readonly SourceQualitySampleRecord[]) {
    return [...new Set(records.map((record) => record.origin))].sort();
}

function quantile(values: readonly number[], probability: number) {
    const index = Math.min(values.length - 1, Math.ceil(values.length * probability) - 1);
    return values[Math.max(0, index)] ?? 0;
}

function isSuccessfulStatus(status: SourceQualitySampleStatus) {
    return status !== "error" && status !== "http-error" && status !== "invalid-response";
}
