import type { SourceID, SourceResponse } from "@shared/types";
import type { NewsInsightOptions } from "@shared/news-insights";
import type { SourceApiError, NewsInsightsResponse } from "@shared/source-api";

import { describeSourceError } from "@shared/source-error";

import { createServerNewsInsights } from "./news-insights";
import { resolveEntireSources } from "./resolve-entire-sources";

interface CacheEntry {
    id: SourceID;
    items: SourceResponse["items"];
    updated: number;
}

interface ResolveNewsInsightsOptions {
    sourceIds: SourceID[];
    cacheEntries: CacheEntry[];
    invalidSourceIds?: string[];
    signal?: AbortSignal;
    fetchMissing: (id: SourceID, signal?: AbortSignal) => Promise<SourceResponse["items"]>;
    saveCache: (id: SourceID, items: SourceResponse["items"]) => Promise<void>;
    now: number;
    insightOptions?: Omit<NewsInsightOptions, "generatedAt" | "sourceWeights">;
    background?: (pending: Promise<unknown>) => void;
    onFetchError?: (error: unknown, id: SourceID) => void;
    onCacheError?: (error: unknown, id: SourceID) => void;
}

export async function resolveNewsInsights({
    sourceIds,
    cacheEntries,
    invalidSourceIds = [],
    signal,
    fetchMissing,
    saveCache,
    now,
    insightOptions,
    background,
    onFetchError,
    onCacheError,
}: ResolveNewsInsightsOptions): Promise<NewsInsightsResponse> {
    const errors: SourceApiError[] = invalidSourceIds.map((sourceId) => ({
        sourceId,
        message: "Invalid source id",
    }));
    const responses = await resolveEntireSources({
        sourceIds,
        cacheEntries,
        signal,
        fetchMissing,
        saveCache,
        now,
        background,
        preferCached: true,
        onCacheError,
        onFetchError: (error, id) => {
            errors.push({
                sourceId: id,
                ...describeSourceError(error),
            });
            onFetchError?.(error, id);
        },
    });
    const resolvedSourceIds = new Set(responses.map((response) => response.id));
    const omittedSourceIds = sourceIds.filter((id) => !resolvedSourceIds.has(id));

    return {
        data: createServerNewsInsights(responses, {
            ...insightOptions,
            generatedAt: now,
        }),
        meta: {
            generatedAt: now,
            requestedSourceCount: sourceIds.length,
            resolvedSourceCount: responses.length,
            partial: omittedSourceIds.length > 0,
            omittedSourceIds,
        },
        errors,
    };
}
