import { filterSourceHealthSnapshots } from "./source-health-filter";

import type { SourceApiError } from "./source-api";
import type { SourceHealthSummary, SourceHealthSnapshot } from "./source-health-types";
import type { SourceHealthFilterStatus, SourceHealthFilterAdapterKind } from "./source-health-filter";

export interface SourceHealthSourcesQuery {
    keyword?: string;
    status?: SourceHealthFilterStatus;
    adapterKind?: SourceHealthFilterAdapterKind;
    limit?: number | string;
}

export interface SourceHealthSourcesMeta {
    generatedAt: number;
    totalSourceCount: number;
    returnedSourceCount: number;
    healthyCount: number;
    failingCount: number;
    idleCount: number;
    cacheDegradedCount: number;
    filters: {
        status: SourceHealthFilterStatus;
        adapterKind: SourceHealthFilterAdapterKind;
        keyword?: string;
        limit?: number;
    };
}

export interface SourceHealthSourcesResponse {
    data: SourceHealthSnapshot[];
    meta: SourceHealthSourcesMeta;
    errors: SourceApiError[];
}

export function createSourceHealthSourcesResponse(
    summary: SourceHealthSummary,
    query: SourceHealthSourcesQuery = {}
): SourceHealthSourcesResponse {
    const status = query.status ?? "all";
    const adapterKind = query.adapterKind ?? "all";
    const keyword = query.keyword?.trim();
    const limit = normalizeHealthSourcesLimit(query.limit);
    const filteredSources = filterSourceHealthSnapshots(summary.sources, { keyword, status, adapterKind });
    const data = typeof limit === "number" ? filteredSources.slice(0, limit) : filteredSources;

    return {
        data,
        meta: {
            generatedAt: summary.updatedAt,
            totalSourceCount: summary.total,
            returnedSourceCount: data.length,
            healthyCount: summary.healthy,
            failingCount: summary.failing,
            idleCount: summary.idle,
            cacheDegradedCount: summary.cacheDegraded,
            filters: {
                status,
                adapterKind,
                ...(keyword && { keyword }),
                ...(limit && { limit }),
            },
        },
        errors: [],
    };
}

export function normalizeHealthSourcesLimit(value: string | number | undefined, max = 500): number | undefined {
    if (value === undefined || value === "") return undefined;

    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
    return Math.min(Math.floor(parsed), max);
}
