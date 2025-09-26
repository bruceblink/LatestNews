import type { SourceID, SourceResponse } from "@shared/types";

import { getCacheTable } from "#/database/cache";
import dataSources from "@shared/data-sources.ts";
import { readBody, defineEventHandler } from "h3";

export default defineEventHandler(async (event) => {
    try {
        const { sources: _ }: { sources: SourceID[] } = await readBody(event);
        const cacheTable = await getCacheTable();
        const ids = _?.filter((k) => dataSources[k]);
        if (ids?.length && cacheTable) {
            const caches = await cacheTable.getEntire(ids);
            const now = Date.now();
            return caches.map((cache) => ({
                status: "cache",
                id: cache.id,
                items: cache.items,
                updatedTime: now - cache.updated < dataSources[cache.id].interval ? now : cache.updated,
            })) as SourceResponse[];
        }
    } catch {
        //
    }
    return undefined;
});
