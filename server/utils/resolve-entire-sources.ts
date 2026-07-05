import type { SourceID, SourceResponse } from "@shared/types";

import { TTL } from "@shared/consts";
import dataSources from "@shared/data-sources";
import { getCachedSourceResponseStatus, getFetchedSourceResponseStatus } from "@shared/source-response-status";

interface CacheEntry {
    id: SourceID;
    items: SourceResponse["items"];
    updated: number;
}

interface ResolveEntireSourcesOptions {
    sourceIds: SourceID[];
    cacheEntries: CacheEntry[];
    fetchMissing: (id: SourceID) => Promise<SourceResponse["items"]>;
    saveCache: (id: SourceID, items: SourceResponse["items"]) => Promise<void>;
    now: number;
    onFetchError?: (error: unknown, id: SourceID) => void;
}

export async function resolveEntireSources({
    sourceIds,
    cacheEntries,
    fetchMissing,
    saveCache,
    now,
    onFetchError,
}: ResolveEntireSourcesOptions): Promise<SourceResponse[]> {
    const cachedResponses = new Map<SourceID, SourceResponse>();

    for (const cache of cacheEntries) {
        cachedResponses.set(cache.id, {
            status: getCachedSourceResponseStatus({
                cacheUpdatedAt: cache.updated,
                now,
                ttl: TTL,
            }),
            id: cache.id,
            name: dataSources[cache.id].name,
            items: cache.items,
            updatedTime: cache.updated,
        });
    }

    const missingIds = sourceIds.filter((id) => !cachedResponses.has(id));
    if (missingIds.length) {
        const fetched = await Promise.allSettled(
            missingIds.map(async (id) => {
                const items = (await fetchMissing(id)).slice(0, 30);
                if (items.length) await saveCache(id, items);
                return {
                    status: getFetchedSourceResponseStatus(items.length),
                    id,
                    name: dataSources[id].name,
                    items,
                    updatedTime: now,
                };
            })
        );

        for (const [index, result] of fetched.entries()) {
            const id = missingIds[index];
            if (result.status === "fulfilled") {
                cachedResponses.set(result.value.id, result.value);
            } else {
                onFetchError?.(result.reason, id);
            }
        }
    }

    return sourceIds
        .map((id) => cachedResponses.get(id))
        .filter((response): response is SourceResponse => Boolean(response));
}
