import type { H3Event } from "h3";
import type { SourceID, SourceResponse } from "@shared/types";

import { z } from "zod";
import { TTL } from "@shared/consts";
import { logger } from "#/utils/logger.ts";
import dataSources from "@shared/data-sources";
import { getCacheTable } from "#/database/cache";
import { fetchSourceItems } from "#/utils/source-fetch";
import { resolveSourceId } from "#/utils/resolve-source-id";
import { getQuery, createError, defineEventHandler } from "h3";
import { getSourceHealthSnapshot } from "#/utils/source-health";
import { isSourceItemsClearCacheRequest } from "@shared/source-items";
import { resolveSourceResponse } from "#/utils/resolve-source-response";
import { shouldDegradeSourceToCache } from "@shared/source-health-policy";

const sourceQuerySchema = z.object({
    clearCache: z
        .union([z.string(), z.array(z.string()), z.boolean()])
        .optional()
        .transform((value) => (Array.isArray(value) ? value[0] : value)),
    id: z.union([z.string(), z.array(z.string())]).transform((value) => (Array.isArray(value) ? value[0] : value)),
    latest: z
        .union([z.string(), z.array(z.string()), z.boolean()])
        .optional()
        .transform((value) => (Array.isArray(value) ? value[0] : value)),
});

function isLatestRequest(latest: string | boolean | undefined) {
    return latest !== undefined && latest !== "false" && latest !== false;
}

function shouldDegradeToCache(id: SourceID) {
    const health = getSourceHealthSnapshot(id);
    return shouldDegradeSourceToCache(health);
}

export default defineEventHandler(async (event): Promise<SourceResponse> => {
    try {
        const parsedQuery = sourceQuerySchema.safeParse(getQuery(event));
        if (!parsedQuery.success) {
            throw createError({
                statusCode: 400,
                message: "Invalid query",
            });
        }

        const latest = isLatestRequest(parsedQuery.data.latest);
        const clearCache = isSourceItemsClearCacheRequest(parsedQuery.data.clearCache);
        const id = resolveSourceId(parsedQuery.data.id);

        return await getCacheOrFetch(id, latest, clearCache, event);
    } catch (e: unknown) {
        logger.error(e);
        if (e && typeof e === "object" && "statusCode" in e) throw e;
        throw createError({
            statusCode: 500,
            message: e instanceof Error ? e.message : "Internal Server Error",
        });
    }
});

/**
 * 尝试获取缓存，如果缓存不可用则获取最新数据并更新缓存
 */
async function getCacheOrFetch(
    id: SourceID,
    latest: boolean,
    clearCache: boolean,
    event: H3Event
): Promise<SourceResponse> {
    const cacheTable = await getCacheTable();
    const now = Date.now();
    const canRefresh = Boolean(event.context.disabledLogin || event.context.user);
    const canClearCache = clearCache && canRefresh;
    let cache = cacheTable ? await cacheTable.get(id) : undefined;

    if (canClearCache && cacheTable) {
        await cacheTable.delete(id);
        cache = undefined;
    }

    const sourceInterval = dataSources[id].interval ?? TTL;
    const degraded = shouldDegradeToCache(id);
    const response = await resolveSourceResponse({
        id,
        name: dataSources[id].name,
        cache,
        latest,
        canRefresh,
        degraded,
        clearCache: canClearCache,
        sourceInterval,
        now,
        fetchLatest: () => fetchSourceItems(id),
        saveCache: async (items) => {
            if (!cacheTable) return;

            const setCache = cacheTable.set(id, items);
            if (event.context.waitUntil) event.context.waitUntil(setCache);
            else await setCache;
        },
        onFetchError: (error) => logger.error(`fetch ${id} latest failed, fallback to stale cache`, error),
    });

    if (response.status === "success" || response.status === "empty") {
        logger.success(`fetch ${id} latest`);
    }

    return response;
}
