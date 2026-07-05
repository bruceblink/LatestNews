import type { SourceHealthSourcesResponse } from "@shared/source-health-api";

import { z } from "zod";
import { logger } from "#/utils/logger";
import { getSourceHealthSummary } from "#/utils/source-health";
import { getQuery, createError, defineEventHandler } from "h3";
import { createSourceHealthSourcesResponse } from "@shared/source-health-api";

const sourceHealthSourcesQuerySchema = z.object({
    keyword: z
        .union([z.string(), z.array(z.string())])
        .optional()
        .transform((value) => (Array.isArray(value) ? value[0] : value)),
    q: z
        .union([z.string(), z.array(z.string())])
        .optional()
        .transform((value) => (Array.isArray(value) ? value[0] : value)),
    limit: z
        .union([z.string(), z.array(z.string()), z.number()])
        .optional()
        .transform((value) => (Array.isArray(value) ? value[0] : value)),
    status: z
        .union([
            z.literal("all"),
            z.literal("healthy"),
            z.literal("failing"),
            z.literal("idle"),
            z.literal("cache-degraded"),
            z.array(z.enum(["all", "healthy", "failing", "idle", "cache-degraded"])),
        ])
        .optional()
        .transform((value) => (Array.isArray(value) ? value[0] : value)),
});

export default defineEventHandler((event): SourceHealthSourcesResponse => {
    try {
        const parsedQuery = sourceHealthSourcesQuerySchema.safeParse(getQuery(event));
        if (!parsedQuery.success) {
            throw createError({
                statusCode: 400,
                message: "Invalid source health query",
            });
        }

        return createSourceHealthSourcesResponse(getSourceHealthSummary(), {
            ...parsedQuery.data,
            keyword: parsedQuery.data.q ?? parsedQuery.data.keyword,
        });
    } catch (error) {
        logger.error(error);
        if (error && typeof error === "object" && "statusCode" in error) throw error;
        throw createError({
            statusCode: 500,
            message: error instanceof Error ? error.message : "Internal Server Error",
        });
    }
});
