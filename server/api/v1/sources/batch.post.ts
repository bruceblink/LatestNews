import type { SourceID } from "@shared/types";
import type { SourceBatchPayload, SourceBatchResponse } from "@shared/source-api";

import { z } from "zod";
import { logger } from "#/utils/logger";
import { getCacheTable } from "#/database/cache";
import { readBody, createError, defineEventHandler } from "h3";
import { resolveSourceBatchSelection } from "@shared/source-batch";
import { hasSourceGetter, fetchSourceItems } from "#/utils/source-fetch";
import { createSourceBatchResponse } from "@shared/source-batch-response";

import { resolveEntireSourcesWithDiagnostics } from "../../../utils/resolve-entire-sources";

const stringOrArraySchema = z.union([z.string(), z.array(z.string())]);
const sourceBatchSchema = z.object({
    column: stringOrArraySchema.optional(),
    limit: z.union([z.string(), z.number()]).optional(),
    since: z.union([z.string(), z.number()]).optional(),
    source: stringOrArraySchema.optional(),
    sources: z.array(z.string()).max(100).optional(),
    type: stringOrArraySchema.optional(),
});

export default defineEventHandler(async (event): Promise<SourceBatchResponse> => {
    try {
        const parsedBody = sourceBatchSchema.safeParse(await readBody(event));
        if (!parsedBody.success) {
            throw createError({
                statusCode: 400,
                message: "Invalid source batch payload",
            });
        }

        const payload = parsedBody.data;
        if (!hasSelector(payload)) {
            throw createError({
                statusCode: 400,
                message: "At least one source selector is required",
            });
        }

        const selected = resolveSourceBatchSelection(payload);
        if (selected.sourceIds.length > 100) {
            throw createError({
                statusCode: 400,
                message: "Too many sources selected",
            });
        }

        const { sourceIds, invalidSourceIds } = normalizeFetchableSources(selected);
        const cacheTable = await getCacheTable();
        const caches = cacheTable ? await cacheTable.getEntire(sourceIds) : [];
        const response = await resolveEntireSourcesWithDiagnostics({
            sourceIds,
            invalidSourceIds,
            cacheEntries: caches,
            fetchMissing: fetchSourceItems,
            saveCache: async (id, items) => {
                if (!cacheTable) return;
                await cacheTable.set(id, items);
            },
            now: Date.now(),
            onFetchError: (error, id) => logger.error(`fetch ${id} v1 batch failed`, error),
        });

        return createSourceBatchResponse(
            {
                ...response,
                meta: {
                    ...response.meta,
                    partial: response.meta.partial || selected.filterErrors.length > 0,
                },
                errors: [...response.errors, ...selected.filterErrors],
            },
            payload,
            sourceIds
        );
    } catch (error) {
        if (error && typeof error === "object" && "statusCode" in error) throw error;
        logger.error(error);
        throw createError({
            statusCode: 500,
            message: error instanceof Error ? error.message : "Internal Server Error",
        });
    }
});

function normalizeFetchableSources(selected: { sourceIds: SourceID[]; invalidSourceIds: string[] }) {
    const sourceIds: SourceID[] = [];
    const invalidSourceIds = [...selected.invalidSourceIds];

    for (const sourceId of selected.sourceIds) {
        if (hasSourceGetter(sourceId)) sourceIds.push(sourceId);
        else invalidSourceIds.push(sourceId);
    }

    return { sourceIds, invalidSourceIds };
}

function hasSelector(payload: SourceBatchPayload) {
    return Boolean(
        normalizeStringArray(payload.sources).length ||
            normalizeStringArray(payload.source).length ||
            normalizeStringArray(payload.column).length ||
            normalizeStringArray(payload.type).length
    );
}

function normalizeStringArray(value: string | string[] | undefined) {
    if (value === undefined) return [];
    return (Array.isArray(value) ? value : [value]).map((item) => item.trim()).filter(Boolean);
}
