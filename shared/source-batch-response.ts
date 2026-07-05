import { filterSourceItems, parseSourceItemsSince, normalizeSourceItemsLimit } from "./source-items";

import type { SourceID, SourceResponse } from "./types";
import type { SourceBatchPayload, SourceBatchResponse, EntireSourcesResponse } from "./source-api";

export function createSourceBatchResponse(
    response: EntireSourcesResponse,
    payload: SourceBatchPayload,
    selectedSourceIds: SourceID[]
): SourceBatchResponse {
    const since = parseSourceItemsSince(payload.since);
    const limit = normalizeSourceItemsLimit(payload.limit);
    const data = response.data.map((source) => filterSourceResponse(source, { since, limit }));
    const itemCount = data.reduce((sum, source) => sum + source.items.length, 0);
    const unfilteredItemCount = response.data.reduce((sum, source) => sum + source.items.length, 0);

    return {
        data,
        meta: {
            ...response.meta,
            itemCount,
            unfilteredItemCount,
            filters: {
                sourceIds: selectedSourceIds,
                columns: normalizeStringArray(payload.column),
                types: normalizeStringArray(payload.type),
                ...(since && { since }),
                ...(limit && { limit }),
            },
        },
        errors: response.errors,
    };
}

function filterSourceResponse(response: SourceResponse, filters: { since?: number; limit?: number }): SourceResponse {
    return {
        ...response,
        items: filterSourceItems(response.items, filters),
    };
}

function normalizeStringArray(value: string | string[] | undefined): string[] {
    if (value === undefined) return [];
    return (Array.isArray(value) ? value : [value]).map((item) => item.trim()).filter(Boolean);
}
