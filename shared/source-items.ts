import type { NewsItem } from "./types";

export interface SourceItemsFilterOptions {
    since?: number;
    limit?: number;
}

export function isSourceItemsClearCacheRequest(value: string | boolean | undefined) {
    return value !== undefined && value !== "false" && value !== false;
}

export function filterSourceItems(items: NewsItem[], { since, limit }: SourceItemsFilterOptions = {}) {
    const filtered = since
        ? items.filter((item) => getItemTime(item) === undefined || getItemTime(item)! >= since)
        : items;
    return typeof limit === "number" ? filtered.slice(0, limit) : filtered;
}

export function parseSourceItemsSince(value: string | number | undefined): number | undefined {
    if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : undefined;
    if (!value) return undefined;

    const numericValue = Number(value);
    if (Number.isFinite(numericValue) && numericValue > 0) return numericValue;

    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

export function normalizeSourceItemsLimit(value: string | number | undefined, max = 100): number | undefined {
    if (value === undefined || value === "") return undefined;

    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
    return Math.min(Math.floor(parsed), max);
}

function getItemTime(item: NewsItem) {
    return parseSourceItemsSince(item.pubDate ?? item.extra?.date);
}
