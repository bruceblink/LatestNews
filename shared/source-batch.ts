import { metadata } from "./metadata";
import dataSources from "./data-sources";
import { objectEntries } from "./type.util";

import type { Source, SourceID, ColumnID } from "./types";
import type { SourceApiError, SourceBatchPayload } from "./source-api";

export interface ResolveSourceBatchSelectionResult {
    sourceIds: SourceID[];
    invalidSourceIds: string[];
    filterErrors: SourceApiError[];
}

const SOURCE_TYPES = new Set(["normal", "hottest", "realtime"]);

export function resolveSourceBatchSelection(payload: SourceBatchPayload): ResolveSourceBatchSelectionResult {
    const selectedIds = new Set<SourceID>();
    const invalidSourceIds: string[] = [];
    const filterErrors: SourceApiError[] = [];

    for (const sourceId of normalizeStringArray(payload.sources)) {
        addSourceId(sourceId, selectedIds, invalidSourceIds);
    }

    for (const sourceId of normalizeStringArray(payload.source)) {
        addSourceId(sourceId, selectedIds, invalidSourceIds);
    }

    for (const column of normalizeStringArray(payload.column)) {
        const sourceIds = getColumnSourceIds(column);
        if (!sourceIds) {
            filterErrors.push({
                message: `Invalid column filter: ${column}`,
            });
            continue;
        }

        for (const sourceId of sourceIds) {
            selectedIds.add(sourceId);
        }
    }

    for (const type of normalizeStringArray(payload.type)) {
        const sourceIds = getTypeSourceIds(type);
        if (!sourceIds) {
            filterErrors.push({
                message: `Invalid type filter: ${type}`,
            });
            continue;
        }

        for (const sourceId of sourceIds) {
            selectedIds.add(sourceId);
        }
    }

    return {
        sourceIds: [...selectedIds],
        invalidSourceIds,
        filterErrors,
    };
}

function addSourceId(input: string, selectedIds: Set<SourceID>, invalidSourceIds: string[]) {
    const sourceId = input as SourceID;
    const redirectId = dataSources[sourceId]?.redirect;
    const resolvedId = redirectId ?? sourceId;
    if (isSelectableSourceId(resolvedId)) {
        selectedIds.add(resolvedId);
    } else {
        invalidSourceIds.push(input);
    }
}

function getColumnSourceIds(column: string): SourceID[] | undefined {
    if (!(column in metadata)) return undefined;
    return metadata[column as ColumnID].sources.filter(isSelectableSourceId);
}

function getTypeSourceIds(type: string): SourceID[] | undefined {
    if (!SOURCE_TYPES.has(type)) return undefined;
    const normalizedType = type === "normal" ? undefined : type;
    return objectEntries(dataSources)
        .filter(([, source]) => !source.redirect && getSourceType(source) === normalizedType)
        .map(([id]) => id)
        .filter(isSelectableSourceId);
}

function getSourceType(source: Source) {
    return source.type;
}

function isSelectableSourceId(id: string): id is SourceID {
    const source = dataSources[id as SourceID];
    return Boolean(source && !source.redirect);
}

function normalizeStringArray(value: string | string[] | undefined): string[] {
    if (value === undefined) return [];
    return (Array.isArray(value) ? value : [value]).map((item) => item.trim()).filter(Boolean);
}
