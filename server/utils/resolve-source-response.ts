import type { NewsItem, SourceID, SourceResponse } from "@shared/types";

import { createError } from "h3";
import { TTL } from "@shared/consts";
import {
    getCachedSourceResponseStatus,
    getFetchedSourceResponseStatus,
    shouldReturnCachedSourceResponse,
} from "@shared/source-response-status";

import { isCancellationError } from "./source-engine";

export const sourceReadTimeoutMs = 4_000;

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
    clearCache?: boolean;
    sourceInterval: number;
    now: number;
    lastAttemptAt?: number;
    ttl?: number;
    waitTimeoutMs?: number;
    signal?: AbortSignal;
    fetchLatest: (signal?: AbortSignal) => Promise<NewsItem[]>;
    saveCache?: (items: NewsItem[]) => Promise<void>;
    background?: (pending: Promise<unknown>) => void;
    onFetchError?: (error: unknown) => void;
}

export async function resolveSourceResponse({
    id,
    name,
    cache,
    latest,
    canRefresh,
    degraded,
    clearCache = false,
    sourceInterval,
    now,
    lastAttemptAt,
    ttl = TTL,
    waitTimeoutMs = sourceReadTimeoutMs,
    signal,
    fetchLatest,
    saveCache,
    background,
    onFetchError,
}: ResolveSourceResponseOptions): Promise<SourceResponse> {
    if (
        cache &&
        !clearCache &&
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

    const collect = async (collectionSignal?: AbortSignal) => {
        try {
            const items = await fetchLatest(collectionSignal);
            collectionSignal?.throwIfAborted();
            if (items.length && saveCache) {
                const write = saveCache(items).catch((error: unknown) => onFetchError?.(error));
                if (background) background(write);
                else await write;
            }
            return items;
        } catch (error) {
            if (!collectionSignal?.aborted && !isCancellationError(error)) onFetchError?.(error);
            throw error;
        }
    };

    if (cache && !clearCache && (!latest || !canRefresh) && background) {
        // A stale ordinary read must finish independently of the crawler.
        if (!signal?.aborted && (lastAttemptAt === undefined || now - lastAttemptAt >= sourceInterval)) {
            background(collect().catch(() => undefined));
        }
        return createCachedResponse({ cache, degraded, id, name, now, ttl });
    }

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) controller.abort();
    const pending = collect(controller.signal);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        const items = await Promise.race([
            pending,
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => {
                    if (background) {
                        // Past the response deadline the request no longer owns the cache fill.
                        signal?.removeEventListener("abort", onAbort);
                        background(pending.catch(() => undefined));
                    } else {
                        controller.abort();
                    }
                    reject(createError({ statusCode: 504, message: "Source collection timed out." }));
                }, waitTimeoutMs);
            }),
        ]);
        if (items.length) {
            return createFetchedResponse({ id, items, name, now });
        }

        if (cache) {
            return createCachedResponse({ cache, id, name, now, status: "stale-cache", ttl });
        }

        return createFetchedResponse({ id, items, name, now });
    } catch (error) {
        if (!cache) throw error;
        return createCachedResponse({ cache, id, name, now, status: "stale-cache", ttl });
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
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
