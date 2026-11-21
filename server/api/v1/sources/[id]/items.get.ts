import type { H3Event } from "h3";
import type { SourceID } from "@shared/types";
import type { SourceItemsResponse } from "@shared/source-api";

import { z } from "zod";
import { logger } from "#/utils/logger";
import { readSource } from "#/utils/read-source";
import { resolveSourceId } from "#/utils/resolve-source-id";
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
    const response = await readSource(
        id,
        isLatestRequest(query.latest),
        isSourceItemsClearCacheRequest(query.clearCache),
        event
    );
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
