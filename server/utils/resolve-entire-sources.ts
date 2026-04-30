import type { SourceID, SourceResponse } from "@shared/types";

import { TTL } from "@shared/consts";
import dataSources from "@shared/data-sources";

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
    onFetchError?: (error: unknown) => void;
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
            status: "cache",
            id: cache.id,
            name: dataSources[cache.id].name,
            items: cache.items,
            updatedTime: now - cache.updated < (dataSources[cache.id].interval ?? TTL) ? now : cache.updated,
        });
    }

    const missingIds = sourceIds.filter((id) => !cachedResponses.has(id));
    if (missingIds.length) {
        const fetched = await Promise.allSettled(
            missingIds.map(async (id) => {
                const items = (await fetchMissing(id)).slice(0, 30);
                if (items.length) await saveCache(id, items);
                return {
                    status: "success" as const,
                    id,
                    name: dataSources[id].name,
                    items,
                    updatedTime: Date.now(),
                };
            })
        );

        for (const result of fetched) {
            if (result.status === "fulfilled") {
                cachedResponses.set(result.value.id, result.value);
            } else {
                onFetchError?.(result.reason);
            }
        }
    }

    return sourceIds
        .map((id) => cachedResponses.get(id))
        .filter((response): response is SourceResponse => Boolean(response));
}
