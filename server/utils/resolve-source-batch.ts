import type { SourceID } from "@shared/types";
import type { SourceBatchPayload, SourceBatchResponse } from "@shared/source-api";

import { createError } from "h3";
import { logger } from "#/utils/logger";
import { getCacheTable } from "#/database/cache";
import { resolveSourceBatchSelection } from "@shared/source-batch";
import { hasSourceGetter, fetchSourceItems } from "#/utils/source-fetch";
import { createSourceBatchResponse } from "@shared/source-batch-response";

import { resolveEntireSourcesWithDiagnostics } from "./resolve-entire-sources";

interface ResolveSourceBatchPayloadOptions {
    now?: number;
    logPrefix?: string;
    background?: (pending: Promise<unknown>) => void;
}

export async function resolveSourceBatchPayload(
    payload: SourceBatchPayload,
    { now = Date.now(), logPrefix = "v1 batch", background }: ResolveSourceBatchPayloadOptions = {}
): Promise<SourceBatchResponse> {
    const selected = resolveSourceBatchSelection(payload);
    if (selected.sourceIds.length > 100) {
        throw createError({
            statusCode: 400,
            message: "Too many sources selected",
        });
    }

    const { sourceIds, invalidSourceIds } = normalizeFetchableSources(selected);
    const cacheTable = await getCacheTable();
    const caches =
        (await cacheTable?.getEntire(sourceIds).catch((error: unknown) => {
            logger.warn(`Could not read ${logPrefix} cache.`, error);
            return [];
        })) ?? [];
    const response = await resolveEntireSourcesWithDiagnostics({
        sourceIds,
        invalidSourceIds,
        cacheEntries: caches,
        fetchMissing: fetchSourceItems,
        saveCache: async (id, items) => {
            if (!cacheTable) return;
            await cacheTable.set(id, items);
        },
        now,
        background,
        onFetchError: (error, id) => logger.error(`fetch ${id} ${logPrefix} failed`, error),
        onCacheError: (error, id) => logger.warn(`Could not save ${id} ${logPrefix} cache.`, error),
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
}

export function hasSourceBatchSelector(payload: SourceBatchPayload) {
    return Boolean(
        normalizeStringArray(payload.sources).length ||
        normalizeStringArray(payload.source).length ||
        normalizeStringArray(payload.column).length ||
        normalizeStringArray(payload.type).length
    );
}

function normalizeFetchableSources(selected: { sourceIds: SourceID[]; invalidSourceIds: string[] }) {
    const sourceIds: SourceID[] = [];
    const invalidSourceIds = [...selected.invalidSourceIds];

    for (const sourceId of selected.sourceIds) {
        if (hasSourceGetter(sourceId)) sourceIds.push(sourceId);
        else invalidSourceIds.push(sourceId);
    }

    return { sourceIds, invalidSourceIds };
}

function normalizeStringArray(value: string | string[] | undefined) {
    if (value === undefined) return [];
    return (Array.isArray(value) ? value : [value]).map((item) => item.trim()).filter(Boolean);
}
