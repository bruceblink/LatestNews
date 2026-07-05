import type { SourceBatchPayload } from "@shared/source-api";

import { z } from "zod";

const stringOrArraySchema = z.union([z.string(), z.array(z.string())]);

export const sourceFeedQuerySchema = z.object({
    column: stringOrArraySchema.optional(),
    description: stringOrArraySchema.optional(),
    limit: z.union([z.string(), z.array(z.string()), z.number()]).optional(),
    maxItems: z.union([z.string(), z.array(z.string()), z.number()]).optional(),
    q: stringOrArraySchema.optional(),
    since: z.union([z.string(), z.array(z.string()), z.number()]).optional(),
    source: stringOrArraySchema.optional(),
    title: stringOrArraySchema.optional(),
    type: stringOrArraySchema.optional(),
});

export function createSourceFeedPayload(query: z.infer<typeof sourceFeedQuerySchema>): SourceBatchPayload {
    return {
        column: normalizeOneOrMany(query.column),
        limit: normalizeSingleValue(query.limit),
        since: normalizeSingleValue(query.since),
        source: normalizeOneOrMany(query.source ?? query.q),
        type: normalizeOneOrMany(query.type),
    };
}

export function getFeedTitle(query: z.infer<typeof sourceFeedQuerySchema>) {
    return normalizeSingleText(query.title) ?? "LatestNews Feed";
}

export function getFeedDescription(query: z.infer<typeof sourceFeedQuerySchema>) {
    return normalizeSingleText(query.description) ?? "LatestNews exported news feed";
}

export function getMaxFeedItems(query: z.infer<typeof sourceFeedQuerySchema>) {
    return normalizePositiveInteger(query.maxItems, 100);
}

export function hasSourceFeedSelector(payload: SourceBatchPayload) {
    return Boolean(
        normalizeStringArray(payload.sources).length ||
            normalizeStringArray(payload.source).length ||
            normalizeStringArray(payload.column).length ||
            normalizeStringArray(payload.type).length
    );
}

function normalizeOneOrMany(value: string | string[] | undefined) {
    const items = normalizeStringArray(value);
    if (!items.length) return undefined;
    return items.length === 1 ? items[0] : items;
}

function normalizeSingleText(value: string | string[] | undefined) {
    if (Array.isArray(value)) return value[0];
    return value;
}

function normalizeSingleValue(value: string | string[] | number | undefined) {
    if (Array.isArray(value)) return value[0];
    return value;
}

function normalizeStringArray(value: string | string[] | undefined) {
    if (value === undefined) return [];
    return (Array.isArray(value) ? value : [value]).map((item) => item.trim()).filter(Boolean);
}

function normalizePositiveInteger(value: string | string[] | number | undefined, max: number) {
    const normalized = normalizeSingleValue(value);
    if (normalized === undefined || normalized === "") return undefined;

    const parsed = Number(normalized);
    if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
    return Math.min(Math.floor(parsed), max);
}
