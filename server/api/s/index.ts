import type { SourceResponse } from "@shared/types";

import { z } from "zod";
import { logger } from "#/utils/logger.ts";
import { readSource } from "#/utils/read-source";
import { resolveSourceId } from "#/utils/resolve-source-id";
import { getQuery, createError, defineEventHandler } from "h3";
import { isSourceItemsClearCacheRequest } from "@shared/source-items";

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

        return await readSource(id, latest, clearCache, event);
    } catch (e: unknown) {
        logger.error(e);
        if (e && typeof e === "object" && "statusCode" in e) throw e;
        throw createError({
            statusCode: 500,
            message: e instanceof Error ? e.message : "Internal Server Error",
        });
    }
});
