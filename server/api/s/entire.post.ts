import type { SourceID } from "@shared/types";

import { z } from "zod";
import { logger } from "#/utils/logger";
import { getCacheTable } from "#/database/cache";
import dataSources from "@shared/data-sources.ts";
import { readBody, createError, defineEventHandler } from "h3";
import { hasSourceGetter, fetchSourceItems } from "#/utils/source-fetch";

import { resolveEntireSources } from "../../utils/resolve-entire-sources";

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
            ...new Set(
                parsedBody.data.sources.filter((key): key is SourceID => {
                    const id = key as SourceID;
                    return Boolean(dataSources[id]) && hasSourceGetter(id);
                })
            ),
        ];

        if (!ids.length) return [];

        const caches = cacheTable ? await cacheTable.getEntire(ids) : [];

        return await resolveEntireSources({
            sourceIds: ids,
            cacheEntries: caches,
            fetchMissing: fetchSourceItems,
            saveCache: async (id, items) => {
                if (!cacheTable) return;
                await cacheTable.set(id, items);
            },
            now: Date.now(),
            onFetchError: (error) => logger.error(error),
        });
    } catch (error) {
        if (error && typeof error === "object" && "statusCode" in error) throw error;
    }
    return [];
});
