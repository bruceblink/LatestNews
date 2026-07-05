import type { SourceID } from "@shared/types";
import type { EntireSourcesResponse } from "@shared/source-api";

import { z } from "zod";
import { logger } from "#/utils/logger";
import { getCacheTable } from "#/database/cache";
import dataSources from "@shared/data-sources.ts";
import { readBody, createError, defineEventHandler } from "h3";
import { hasSourceGetter, fetchSourceItems } from "#/utils/source-fetch";

import { resolveEntireSourcesWithDiagnostics } from "../../utils/resolve-entire-sources";

const entireSourcesSchema = z.object({
    sources: z.array(z.string()).max(100),
});

export default defineEventHandler(async (event): Promise<EntireSourcesResponse> => {
    try {
        const parsedBody = entireSourcesSchema.safeParse(await readBody(event));
        if (!parsedBody.success) {
            throw createError({
                statusCode: 400,
                message: "Invalid sources payload",
            });
        }

        const cacheTable = await getCacheTable();
        const requestedIds = [...new Set(parsedBody.data.sources)];
        const ids: SourceID[] = [];
        const invalidSourceIds: string[] = [];

        for (const key of requestedIds) {
            const id = key as SourceID;
            if (Boolean(dataSources[id]) && hasSourceGetter(id)) ids.push(id);
            else invalidSourceIds.push(key);
        }

        const caches = cacheTable ? await cacheTable.getEntire(ids) : [];
        const now = Date.now();

        return await resolveEntireSourcesWithDiagnostics({
            sourceIds: ids,
            invalidSourceIds,
            cacheEntries: caches,
            fetchMissing: fetchSourceItems,
            saveCache: async (id, items) => {
                if (!cacheTable) return;
                await cacheTable.set(id, items);
            },
            now,
            onFetchError: (error, id) => logger.error(`fetch ${id} entire failed`, error),
        });
    } catch (error) {
        if (error && typeof error === "object" && "statusCode" in error) throw error;
        logger.error(error);
        throw createError({
            statusCode: 500,
            message: error instanceof Error ? error.message : "Internal Server Error",
        });
    }
});
