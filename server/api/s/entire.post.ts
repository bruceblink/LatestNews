import type { SourceID, SourceResponse } from "@shared/types";

import { getCacheTable } from "#/database/cache";

export default defineEventHandler(async (event) => {
    try {
        const body = (await readBody(event)) as { sources: SourceID[] };
        const { sources: sourceIds } = body;

        if (!sourceIds || sourceIds.length === 0) return undefined;

        const cacheTable = await getCacheTable();
        if (!cacheTable) return undefined;

        // 过滤掉 sources 中不存在的 key
        const validIds = sourceIds.filter((id): id is SourceID => id in sources);
        if (validIds.length === 0) return undefined;

        const caches = await cacheTable.getEntire(validIds);
        const now = Date.now();

        return caches
            .map((cache) => {
                // 确保类型安全
                const source = sources[cache.id as keyof typeof sources];
                if (!source) return null;

                const updatedTime = now - cache.updated < source.interval ? now : cache.updated;

                return {
                    status: "cache",
                    id: cache.id,
                    items: cache.items,
                    updatedTime,
                } as SourceResponse;
            })
            .filter((r): r is SourceResponse => r !== null);
    } catch (e) {
        console.error("Failed to handle cache request:", e);
        return undefined;
    }
});
