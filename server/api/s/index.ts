import type { SourceID, SourceResponse } from "@shared/types";

import { getters } from "#/getters";
import { TTL } from "@shared/consts";
import { logger } from "#/utils/logger.ts";
import dataSources from "@shared/data-sources";
import { getCacheTable } from "#/database/cache";
import { getQuery, createError, defineEventHandler } from "h3";

const isValidSource = (id?: SourceID) => !!id && !!dataSources[id] && !!getters[id];

export default defineEventHandler(async (event): Promise<SourceResponse> => {
    try {
        const query = getQuery(event);
        const latest = query.latest !== undefined && query.latest !== "false";
        let id = query.id as SourceID;

        // 检查 source id 是否有效
        if (!isValidSource(id)) {
            const redirectID = dataSources?.[id]?.redirect;
            if (redirectID) id = redirectID;
            if (!isValidSource(id)) throw new Error("Invalid source id");
        }

        // 调用封装好的函数处理缓存或获取最新数据
        return await getCacheOrFetch(id, latest, event);
    } catch (e: any) {
        logger.error(e);
        throw createError({
            statusCode: 500,
            message: e instanceof Error ? e.message : "Internal Server Error",
        });
    }
});

/**
 * 尝试获取缓存，如果缓存不可用则获取最新数据并更新缓存
 */
async function getCacheOrFetch(id: SourceID, latest: boolean, event: any): Promise<SourceResponse> {
    const cacheTable = await getCacheTable();
    const now = Date.now();
    let cache: { updated: number; items: any[] } | undefined;

    if (cacheTable) {
        cache = await cacheTable.get(id);
    }

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
    const newData = (await getters[id]()).slice(0, 30);

    if (cacheTable && newData.length) {
        const setCache = cacheTable.set(id, newData);
        if (event.context.waitUntil) event.context.waitUntil(setCache);
        else await setCache;
    }

    logger.success(`fetch ${id} latest`);
    return { status: "success", id, name: dataSources[id].name, updatedTime: now, items: newData };
}
