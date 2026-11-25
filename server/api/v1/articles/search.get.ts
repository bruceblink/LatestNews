import type { SourceID } from "@shared/types";
import type { ArticleSearchResponse } from "@shared/source-api";

import { z } from "zod";
import { articleTimestamp } from "@shared/article-time";
import { getQuery, createError, defineEventHandler } from "h3";

import { getCacheTable } from "../../../database/cache";

const articleSearchQuerySchema = z.object({
    q: z.union([z.string(), z.array(z.string())]).transform((value) => (Array.isArray(value) ? value[0] : value)),
    source: z
        .union([z.string(), z.array(z.string())])
        .optional()
        .transform((value) => (Array.isArray(value) ? value[0] : value)),
    since: z
        .union([z.string(), z.number(), z.array(z.union([z.string(), z.number()]))])
        .optional()
        .transform((value) => (Array.isArray(value) ? value[0] : value)),
    limit: z
        .union([z.string(), z.number(), z.array(z.union([z.string(), z.number()]))])
        .optional()
        .transform((value) => (Array.isArray(value) ? value[0] : value)),
});

export default defineEventHandler(async (event): Promise<ArticleSearchResponse> => {
    const parsed = articleSearchQuerySchema.safeParse(getQuery(event));
    if (!parsed.success || !parsed.data.q.trim() || parsed.data.q.trim().length > 256) {
        throw createError({ statusCode: 400, message: "Article search requires q between 1 and 256 characters." });
    }

    const limit = parseLimit(parsed.data.limit);
    const since = parseSince(parsed.data.since);
    const sourceId = parsed.data.source?.trim() || undefined;
    const cache = await getCacheTable(event);
    if (!cache) {
        throw createError({ statusCode: 503, message: "Article search is unavailable without a writable cache." });
    }

    const result = await cache.searchArticles({
        query: parsed.data.q,
        ...(sourceId ? { sourceId: sourceId as SourceID } : {}),
        ...(since !== undefined ? { since } : {}),
        limit,
    });
    if (result.status === "unavailable") {
        throw createError({ statusCode: 503, message: "Article search index is unavailable on this deployment." });
    }

    return {
        data: {
            status: result.status,
            searchMode: result.mode,
            query: parsed.data.q.trim(),
            items: result.items,
        },
        meta: {
            generatedAt: Date.now(),
            itemCount: result.items.length,
            ...(sourceId ? { sourceId: sourceId as SourceID } : {}),
            ...(since !== undefined ? { since } : {}),
            limit,
        },
        errors: [],
    };
});

function parseLimit(value: string | number | undefined) {
    if (value === undefined) return 30;
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
        throw createError({ statusCode: 400, message: "Article search limit must be between 1 and 100." });
    }
    return parsed;
}

function parseSince(value: string | number | undefined) {
    if (value === undefined) return undefined;
    const timestamp = articleTimestamp(value);
    if (timestamp === null) throw createError({ statusCode: 400, message: "Invalid article search since value." });
    return timestamp;
}
