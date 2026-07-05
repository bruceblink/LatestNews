import type { H3Event } from "h3";
import type { SourceID, SourceResponse } from "@shared/types";

import { z } from "zod";
import { TTL } from "@shared/consts";
import { logger } from "#/utils/logger.ts";
import dataSources from "@shared/data-sources";
import { getCacheTable } from "#/database/cache";
import { getQuery, createError, defineEventHandler } from "h3";
import { getSourceHealthSnapshot } from "#/utils/source-health";
import { resolveSourceResponse } from "#/utils/resolve-source-response";
import { hasSourceGetter, fetchSourceItems } from "#/utils/source-fetch";
import { shouldDegradeSourceToCache } from "@shared/source-health-policy";

const isValidSource = (id?: SourceID) => !!id && !!dataSources[id] && hasSourceGetter(id);
const sourceQuerySchema = z.object({
    id: z.union([z.string(), z.array(z.string())]).transform((value) => (Array.isArray(value) ? value[0] : value)),
    latest: z
        .union([z.string(), z.array(z.string()), z.boolean()])
        .optional()
        .transform((value) => (Array.isArray(value) ? value[0] : value)),
});

function resolveSourceId(input: string): SourceID {
    const initialId = input as SourceID;
    if (isValidSource(initialId)) return initialId;

    const redirectID = dataSources[input as keyof typeof dataSources]?.redirect;
    if (redirectID && isValidSource(redirectID)) return redirectID;

    throw createError({
        statusCode: 400,
        message: "Invalid source id",
    });
}

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
        const id = resolveSourceId(parsedQuery.data.id);

        return await getCacheOrFetch(id, latest, event);
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
async function getCacheOrFetch(id: SourceID, latest: boolean, event: H3Event): Promise<SourceResponse> {
    const cacheTable = await getCacheTable();
    const now = Date.now();
    const cache = cacheTable ? await cacheTable.get(id) : undefined;

    const sourceInterval = dataSources[id].interval ?? TTL;
    const degraded = shouldDegradeToCache(id);
    const response = await resolveSourceResponse({
        id,
        name: dataSources[id].name,
        cache,
        latest,
        canRefresh: Boolean(event.context.disabledLogin || event.context.user),
        degraded,
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
