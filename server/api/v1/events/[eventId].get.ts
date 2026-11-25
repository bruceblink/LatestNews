import type { ArticleEventResponse } from "@shared/source-api";

import { z } from "zod";
import { getQuery, createError, getRouterParam, defineEventHandler } from "h3";

import { getCacheTable } from "../../../database/cache";

const keySchema = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
const querySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(30),
    after: keySchema.optional(),
});

export default defineEventHandler(async (event): Promise<ArticleEventResponse> => {
    const eventId = keySchema.safeParse(getRouterParam(event, "eventId"));
    const query = querySchema.safeParse(getQuery(event));
    if (!eventId.success || !query.success) {
        throw createError({ statusCode: 400, message: "Invalid event ID or pagination." });
    }

    const cache = await getCacheTable();
    const result = await cache?.getArticleEvent(eventId.data, query.data);
    if (!result || result.status === "unavailable") {
        throw createError({ statusCode: 503, message: "Article event registry is unavailable on this deployment." });
    }
    if (result.status === "not-found") {
        throw createError({ statusCode: 404, message: "Article event not found." });
    }
    return {
        data: {
            eventId: eventId.data,
            ...(result.canonicalEventId ? { canonicalEventId: result.canonicalEventId } : {}),
            registeredAt: result.registeredAt,
            items: result.items,
        },
        meta: {
            generatedAt: Date.now(),
            itemCount: result.items.length,
            limit: query.data.limit,
            ...(result.nextCursor === undefined ? {} : { nextCursor: result.nextCursor }),
        },
        errors: [],
    };
});
