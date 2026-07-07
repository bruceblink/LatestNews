import type { H3Event } from "h3";
import type { SourceID } from "@shared/types";
import type { SourceItemsResponse } from "@shared/source-api";

import { z } from "zod";
import { TTL } from "@shared/consts";
import { logger } from "#/utils/logger";
import dataSources from "@shared/data-sources";
import { getCacheTable } from "#/database/cache";
import { fetchSourceItems } from "#/utils/source-fetch";
import { resolveSourceId } from "#/utils/resolve-source-id";
import { getSourceHealthSnapshot } from "#/utils/source-health";
import { resolveSourceResponse } from "#/utils/resolve-source-response";
import { shouldDegradeSourceToCache } from "@shared/source-health-policy";
import { getQuery, createError, getRouterParam, defineEventHandler } from "h3";
import {
    filterSourceItems,
    parseSourceItemsSince,
    normalizeSourceItemsLimit,
    isSourceItemsClearCacheRequest,
} from "@shared/source-items";

const sourceItemsQuerySchema = z.object({
    clearCache: z
        .union([z.string(), z.array(z.string()), z.boolean()])
        .optional()
        .transform((value) => (Array.isArray(value) ? value[0] : value)),
    latest: z
        .union([z.string(), z.array(z.string()), z.boolean()])
        .optional()
        .transform((value) => (Array.isArray(value) ? value[0] : value)),
    limit: z
        .union([z.string(), z.array(z.string()), z.number()])
        .optional()
        .transform((value) => (Array.isArray(value) ? value[0] : value)),
    since: z
        .union([z.string(), z.array(z.string()), z.number()])
        .optional()
        .transform((value) => (Array.isArray(value) ? value[0] : value)),
});

export default defineEventHandler(async (event): Promise<SourceItemsResponse> => {
    try {
        const parsedQuery = sourceItemsQuerySchema.safeParse(getQuery(event));
        if (!parsedQuery.success) {
            throw createError({
                statusCode: 400,
                message: "Invalid source items query",
            });
        }

        const sourceId = getRouterParam(event, "id");
        if (!sourceId) {
            throw createError({
                statusCode: 400,
                message: "Invalid source id",
            });
        }

        const id = resolveSourceId(sourceId);
        return await getSourceItemsResponse(id, parsedQuery.data, event);
    } catch (error) {
        logger.error(error);
        if (error && typeof error === "object" && "statusCode" in error) throw error;
        throw createError({
            statusCode: 500,
            message: error instanceof Error ? error.message : "Internal Server Error",
        });
    }
});

async function getSourceItemsResponse(
    id: SourceID,
    query: z.infer<typeof sourceItemsQuerySchema>,
    event: H3Event
): Promise<SourceItemsResponse> {
    const now = Date.now();
    const cacheTable = await getCacheTable();
    const canRefresh = Boolean(event.context.disabledLogin || event.context.user);
    const clearCache = isSourceItemsClearCacheRequest(query.clearCache) && canRefresh;
    let cache = cacheTable ? await cacheTable.get(id) : undefined;

    if (clearCache && cacheTable) {
        await cacheTable.delete(id);
        cache = undefined;
    }

    const sourceInterval = dataSources[id].interval ?? TTL;
    const degraded = shouldDegradeSourceToCache(getSourceHealthSnapshot(id));
    const response = await resolveSourceResponse({
        id,
        name: dataSources[id].name,
        cache,
        latest: isLatestRequest(query.latest),
        canRefresh,
        degraded,
        clearCache,
        sourceInterval,
        now,
        fetchLatest: () => fetchSourceItems(id),
        saveCache: async (items) => {
            if (!cacheTable) return;

            const setCache = cacheTable.set(id, items);
            if (event.context.waitUntil) event.context.waitUntil(setCache);
            else await setCache;
        },
        onFetchError: (error) => logger.error(`fetch ${id} v1 items failed, fallback to stale cache`, error),
    });
    const since = parseSourceItemsSince(query.since);
    const limit = normalizeSourceItemsLimit(query.limit);
    const items = filterSourceItems(response.items, { since, limit });

    return {
        data: {
            ...response,
            items,
        },
        meta: {
            generatedAt: now,
            sourceId: id,
            status: response.status,
            itemCount: items.length,
            unfilteredItemCount: response.items.length,
            ...(since && { since }),
            ...(limit && { limit }),
        },
        errors: [],
    };
}

function isLatestRequest(latest: string | boolean | undefined) {
    return latest !== undefined && latest !== "false" && latest !== false;
}
