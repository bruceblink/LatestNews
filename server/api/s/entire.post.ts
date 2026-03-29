import type { SourceID, SourceResponse } from "@shared/types";

import { z } from "zod";
import { TTL } from "@shared/consts";
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
        if (ids?.length && cacheTable) {
            const caches = await cacheTable.getEntire(ids);
            const now = Date.now();
            return caches.map((cache) => ({
                status: "cache",
                id: cache.id,
                name: dataSources[cache.id].name,
                items: cache.items,
                updatedTime: now - cache.updated < (dataSources[cache.id].interval ?? TTL) ? now : cache.updated,
            })) as SourceResponse[];
        }
        return [];
    } catch (error) {
        if (error && typeof error === "object" && "statusCode" in error) throw error;
    }
    return [];
});
