import type { SourceID, SourceResponse } from "@shared/types";
import type { SourceApiError, EntireSourcesResponse } from "@shared/source-api";

import { TTL } from "@shared/consts";
import dataSources from "@shared/data-sources";
import { getCachedSourceResponseStatus, getFetchedSourceResponseStatus } from "@shared/source-response-status";

interface CacheEntry {
    id: SourceID;
    items: SourceResponse["items"];
    updated: number;
}

interface ResolveEntireSourcesOptions {
    sourceIds: SourceID[];
    cacheEntries: CacheEntry[];
    fetchMissing: (id: SourceID) => Promise<SourceResponse["items"]>;
    saveCache: (id: SourceID, items: SourceResponse["items"]) => Promise<void>;
    now: number;
    batchTimeoutMs?: number;
    onFetchError?: (error: unknown, id: SourceID) => void;
}

interface ResolveEntireSourcesWithDiagnosticsOptions extends ResolveEntireSourcesOptions {
    invalidSourceIds?: string[];
}

export async function resolveEntireSources({
    sourceIds,
    cacheEntries,
    fetchMissing,
    saveCache,
    now,
    batchTimeoutMs = 8_000,
    onFetchError,
}: ResolveEntireSourcesOptions): Promise<SourceResponse[]> {
    const cachedResponses = new Map<SourceID, SourceResponse>();

    for (const cache of cacheEntries) {
        cachedResponses.set(cache.id, {
            status: getCachedSourceResponseStatus({
                cacheUpdatedAt: cache.updated,
                now,
                ttl: TTL,
            }),
            id: cache.id,
            name: dataSources[cache.id].name,
            items: cache.items,
            updatedTime: cache.updated,
        });
    }

    const missingIds = sourceIds.filter((id) => !cachedResponses.has(id));
    if (missingIds.length) {
        if (!Number.isFinite(batchTimeoutMs) || batchTimeoutMs < 1) {
            throw new RangeError("batchTimeoutMs must be a positive number.");
        }
        const states = new Map<SourceID, FetchState>();
        const tasks = missingIds.map((id) =>
            (async () => {
                const items = (await fetchMissing(id)).slice(0, 30);
                if (items.length) await saveCache(id, items);
                return {
                    status: getFetchedSourceResponseStatus(items.length),
                    id,
                    name: dataSources[id].name,
                    items,
                    updatedTime: now,
                } satisfies SourceResponse;
            })().then(
                (value) => states.set(value.id, { status: "fulfilled", value }),
                (reason) => states.set(id, { status: "rejected", reason })
            )
        );

        let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<void>((resolve) => {
            timeoutTimer = setTimeout(resolve, batchTimeoutMs);
        });
        try {
            await Promise.race([Promise.allSettled(tasks), timeout]);
        } finally {
            if (timeoutTimer) clearTimeout(timeoutTimer);
        }

        for (const id of missingIds) {
            const state = states.get(id);
            if (!state) {
                onFetchError?.(new SourceBatchTimeoutError(batchTimeoutMs), id);
            } else if (state.status === "fulfilled") {
                cachedResponses.set(state.value.id, state.value);
            } else {
                onFetchError?.(state.reason, id);
            }
        }
    }

    return sourceIds
        .map((id) => cachedResponses.get(id))
        .filter((response): response is SourceResponse => Boolean(response));
}

type FetchState = { status: "fulfilled"; value: SourceResponse } | { status: "rejected"; reason: unknown };

class SourceBatchTimeoutError extends Error {
    readonly code = "BATCH_TIMEOUT" as const;

    constructor(timeoutMs: number) {
        super(`Source batch exceeded its ${timeoutMs} ms wait limit.`);
        this.name = "SourceBatchTimeoutError";
    }
}

export async function resolveEntireSourcesWithDiagnostics({
    invalidSourceIds = [],
    onFetchError,
    ...options
}: ResolveEntireSourcesWithDiagnosticsOptions): Promise<EntireSourcesResponse> {
    const errors: SourceApiError[] = invalidSourceIds.map((sourceId) => ({
        sourceId,
        message: "Invalid source id",
    }));
    const data = await resolveEntireSources({
        ...options,
        onFetchError: (error, id) => {
            errors.push({
                sourceId: id,
                message: getErrorMessage(error),
            });
            onFetchError?.(error, id);
        },
    });
    const resolvedSourceIds = new Set(data.map((response) => response.id));
    const omittedSourceIds = options.sourceIds.filter((id) => !resolvedSourceIds.has(id));

    return {
        data,
        meta: {
            generatedAt: options.now,
            requestedSourceCount: options.sourceIds.length + invalidSourceIds.length,
            resolvedSourceCount: data.length,
            partial: errors.length > 0 || omittedSourceIds.length > 0,
            omittedSourceIds,
        },
        errors,
    };
}

function getErrorMessage(error: unknown) {
    if (error instanceof Error) return error.message;
    if (typeof error === "string" && error.trim()) return error;
    return "Unknown source fetch error";
}
