import type { SourceID, SourceResponse } from "@shared/types";

import { z } from "zod";
import { getters } from "#/getters";
import { TTL } from "@shared/consts";
import { logger } from "#/utils/logger";
import { getCacheTable } from "#/database/cache";
import dataSources from "@shared/data-sources.ts";
import { readBody, createError, defineEventHandler } from "h3";

const entireSourcesSchema = z.object({
    sources: z.array(z.string()).max(100),
});

export default defineEventHandler(async (event) => {
    try {
        const parsedBody = entireSourcesSchema.safeParse(await readBody(event));
        if (!parsedBody.success) {
            throw createError({
                statusCode: 400,
                message: "Invalid sources payload",
            });
        }

        const cacheTable = await getCacheTable();
        const ids = [
            ...new Set(parsedBody.data.sources.filter((key): key is SourceID => Boolean(dataSources[key as SourceID]))),
        ];

        if (!ids.length) return [];

        const now = Date.now();
        const cachedResponses = new Map<SourceID, SourceResponse>();

        if (cacheTable) {
            const caches = await cacheTable.getEntire(ids);
            for (const cache of caches) {
                cachedResponses.set(cache.id, {
                    status: "cache",
                    id: cache.id,
                    name: dataSources[cache.id].name,
                    items: cache.items,
                    updatedTime: now - cache.updated < (dataSources[cache.id].interval ?? TTL) ? now : cache.updated,
                });
            }
        }

        const missingIds = ids.filter((id) => !cachedResponses.has(id));

        if (missingIds.length && cacheTable) {
            const fetched = await Promise.allSettled(
                missingIds.map(async (id) => {
                    const items = (await getters[id]()).slice(0, 30);
                    if (items.length) await cacheTable.set(id, items);
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
                    logger.error(result.reason);
                }
            }
        }

        return ids
            .map((id) => cachedResponses.get(id))
            .filter((response): response is SourceResponse => Boolean(response));
    } catch (error) {
        if (error && typeof error === "object" && "statusCode" in error) throw error;
    }
    return [];
});
