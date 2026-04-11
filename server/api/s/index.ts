import type { H3Event } from "h3";
import type { NewsItem, SourceID, SourceResponse } from "@shared/types";

import { z } from "zod";
import { getters } from "#/getters";
import { TTL } from "@shared/consts";
import { logger } from "#/utils/logger.ts";
import dataSources from "@shared/data-sources";
import { getCacheTable } from "#/database/cache";
import { getQuery, createError, defineEventHandler } from "h3";
import { recordSourceFailure, recordSourceSuccess } from "#/utils/source-health";

const isValidSource = (id?: SourceID) => !!id && !!dataSources[id] && !!getters[id];
const inflightRequests = new Map<SourceID, Promise<NewsItem[]>>();
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

function fetchLatestItems(id: SourceID) {
    const pending = inflightRequests.get(id);
    if (pending) return pending;

    const startTime = Date.now();
    const request = getters[id]()
        .then((items) => {
            const normalizedItems = items.slice(0, 30);
            recordSourceSuccess(id, Date.now() - startTime, normalizedItems.length);
            return normalizedItems;
        })
        .catch((error) => {
            recordSourceFailure(id, Date.now() - startTime, error);
            throw error;
        })
        .finally(() => {
            inflightRequests.delete(id);
        });

    inflightRequests.set(id, request);
    return request;
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

    // 1. interval 内直接返回缓存（视为最新）
    if (cache && now - cache.updated < sourceInterval) {
        return { status: "success", id, updatedTime: cache.updated, name: dataSources[id].name, items: cache.items };
    }

    // 2. TTL 内，根据 latest 和登录状态判断是否返回缓存
    if (cache && now - cache.updated < TTL) {
        if (!latest || (!event.context.disabledLogin && !event.context.user)) {
            return { status: "cache", id, name: dataSources[id].name, updatedTime: cache.updated, items: cache.items };
        }
    }

    // 3. 缓存不可用或需要刷新，获取最新数据
    const newData = await fetchLatestItems(id);

    if (cacheTable && newData.length) {
        const setCache = cacheTable.set(id, newData);
        if (event.context.waitUntil) event.context.waitUntil(setCache);
        else await setCache;
    }

    logger.success(`fetch ${id} latest`);
    return { status: "success", id, name: dataSources[id].name, updatedTime: now, items: newData };
}
