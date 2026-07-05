import type { SourceID, SourceResponse } from "@shared/types";
import type { NewsInsightOptions } from "@shared/news-insights";
import type { SourceApiError, NewsInsightsResponse } from "@shared/source-api";

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
    fetchMissing: (id: SourceID) => Promise<SourceResponse["items"]>;
    saveCache: (id: SourceID, items: SourceResponse["items"]) => Promise<void>;
    now: number;
    insightOptions?: Omit<NewsInsightOptions, "generatedAt" | "sourceWeights">;
    onFetchError?: (error: unknown, id: SourceID) => void;
}

export async function resolveNewsInsights({
    sourceIds,
    cacheEntries,
    invalidSourceIds = [],
    fetchMissing,
    saveCache,
    now,
    insightOptions,
    onFetchError,
}: ResolveNewsInsightsOptions): Promise<NewsInsightsResponse> {
    const errors: SourceApiError[] = invalidSourceIds.map((sourceId) => ({
        sourceId,
        message: "Invalid source id",
    }));
    const responses = await resolveEntireSources({
        sourceIds,
        cacheEntries,
        fetchMissing,
        saveCache,
        now,
        onFetchError: (error, id) => {
            errors.push({
                sourceId: id,
                message: getErrorMessage(error),
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

function getErrorMessage(error: unknown) {
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;
    return "Unknown source fetch error";
}
