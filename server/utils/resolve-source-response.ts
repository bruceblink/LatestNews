import type { NewsItem, SourceID, SourceResponse } from "@shared/types";

import { TTL } from "@shared/consts";
import {
    getCachedSourceResponseStatus,
    getFetchedSourceResponseStatus,
    shouldReturnCachedSourceResponse,
} from "@shared/source-response-status";

interface SourceCacheEntry {
    items: NewsItem[];
    updated: number;
}

interface ResolveSourceResponseOptions {
    id: SourceID;
    name?: string;
    cache?: SourceCacheEntry;
    latest: boolean;
    canRefresh: boolean;
    degraded: boolean;
    sourceInterval: number;
    now: number;
    ttl?: number;
    fetchLatest: () => Promise<NewsItem[]>;
    saveCache?: (items: NewsItem[]) => Promise<void>;
    onFetchError?: (error: unknown) => void;
}

export async function resolveSourceResponse({
    id,
    name,
    cache,
    latest,
    canRefresh,
    degraded,
    sourceInterval,
    now,
    ttl = TTL,
    fetchLatest,
    saveCache,
    onFetchError,
}: ResolveSourceResponseOptions): Promise<SourceResponse> {
    if (
        cache &&
        shouldReturnCachedSourceResponse({
            cacheUpdatedAt: cache.updated,
            canRefresh,
            degraded,
            latest,
            now,
            sourceInterval,
            ttl,
        })
    ) {
        return createCachedResponse({ cache, degraded, id, name, now, ttl });
    }

    try {
        const items = await fetchLatest();
        if (items.length) {
            await saveCache?.(items);
            return createFetchedResponse({ id, items, name, now });
        }

        if (cache) {
            return createCachedResponse({ cache, id, name, now, status: "stale-cache", ttl });
        }

        return createFetchedResponse({ id, items, name, now });
    } catch (error) {
        if (!cache) throw error;
        onFetchError?.(error);
        return createCachedResponse({ cache, id, name, now, status: "stale-cache", ttl });
    }
}

function createFetchedResponse({
    id,
    items,
    name,
    now,
}: {
    id: SourceID;
    items: NewsItem[];
    name?: string;
    now: number;
}): SourceResponse {
    return {
        status: getFetchedSourceResponseStatus(items.length),
        id,
        name,
        updatedTime: now,
        items,
    };
}

function createCachedResponse({
    cache,
    degraded = false,
    id,
    name,
    now,
    status,
    ttl,
}: {
    cache: SourceCacheEntry;
    degraded?: boolean;
    id: SourceID;
    name?: string;
    now: number;
    status?: SourceResponse["status"];
    ttl: number;
}): SourceResponse {
    return {
        status:
            status ??
            getCachedSourceResponseStatus({
                cacheUpdatedAt: cache.updated,
                degraded,
                now,
                ttl,
            }),
        id,
        name,
        updatedTime: cache.updated,
        items: cache.items,
    };
}
