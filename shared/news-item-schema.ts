import { z } from "zod";

import type { NewsItem, SourceID } from "./types";

const DEFAULT_LIMIT = 30;
const TRACKING_QUERY_PATTERN = /^(utm_|spm$|from$|ref$|source$|share$|fbclid$|gclid$|igshid$|yclid$)/i;

const dateValueSchema = z.union([z.number(), z.string()]);
const iconSchema = z.union([
    z.literal(false),
    z.string(),
    z.object({
        url: z.string(),
        scale: z.number(),
    }),
]);
const newsItemSchema = z
    .object({
        id: z.union([z.string(), z.number()]).optional().nullable(),
        title: z.string(),
        url: z.string(),
        mobileUrl: z.string().optional().nullable(),
        pubDate: dateValueSchema.optional().nullable(),
        extra: z
            .object({
                hover: z.string().optional(),
                date: dateValueSchema.optional(),
                info: z.union([z.literal(false), z.string()]).optional(),
                diff: z.number().optional(),
                icon: iconSchema.optional(),
            })
            .optional(),
    })
    .passthrough();

export interface NormalizeNewsItemsOptions {
    sourceId?: SourceID;
    limit?: number;
}

export function normalizeNewsItems(items: unknown[], options: NormalizeNewsItemsOptions = {}): NewsItem[] {
    const limit = options.limit ?? DEFAULT_LIMIT;
    const normalizedItems: NewsItem[] = [];
    const seenUrls = new Set<string>();

    for (const item of items) {
        const normalized = normalizeNewsItem(item, options.sourceId);
        if (!normalized) continue;

        const urlKey = normalizeNewsItemUrlKey(normalized.url);
        if (seenUrls.has(urlKey)) continue;
        seenUrls.add(urlKey);

        normalizedItems.push(normalized);
        if (normalizedItems.length >= limit) break;
    }

    return normalizedItems;
}

export function normalizeNewsItem(item: unknown, sourceId?: SourceID): NewsItem | undefined {
    const parsed = newsItemSchema.safeParse(item);
    if (!parsed.success) return undefined;

    const title = parsed.data.title.trim();
    const url = parsed.data.url.trim();
    if (!title || !url) return undefined;

    const mobileUrl = parsed.data.mobileUrl?.trim();
    const extraDate = normalizeDateValue(parsed.data.extra?.date);
    const pubDate = normalizeDateValue(parsed.data.pubDate) ?? extraDate;
    const extra = parsed.data.extra
        ? {
              ...parsed.data.extra,
              date: extraDate,
          }
        : undefined;

    if (extra?.date === undefined) delete extra?.date;

    return {
        ...parsed.data,
        id: normalizeNewsItemId(parsed.data.id, url, sourceId),
        title,
        url,
        mobileUrl: mobileUrl || undefined,
        pubDate,
        extra,
    };
}

export function normalizeNewsItemUrlKey(url: string): string {
    const trimmed = url.trim();
    if (!trimmed) return "";

    try {
        const parsed = new URL(trimmed);
        parsed.hash = "";
        parsed.hostname = parsed.hostname
            .toLowerCase()
            .replace(/^m\./, "")
            .replace(/^www\./, "");

        for (const key of [...parsed.searchParams.keys()]) {
            if (TRACKING_QUERY_PATTERN.test(key)) parsed.searchParams.delete(key);
        }

        const normalized = parsed.toString();
        return normalized.endsWith("/") && parsed.pathname !== "/" ? normalized.slice(0, -1) : normalized;
    } catch {
        return trimmed.replace(/[?#].*$/, "").replace(/\/$/, "");
    }
}

function normalizeNewsItemId(id: string | number | null | undefined, url: string, sourceId?: SourceID) {
    if (typeof id === "number" && Number.isFinite(id)) return id;
    if (typeof id === "string" && id.trim()) return id.trim();

    const prefix = sourceId ? `${sourceId}:` : "";
    return `${prefix}url-${hashString(normalizeNewsItemUrlKey(url))}`;
}

function normalizeDateValue(value: number | string | null | undefined): number | string | undefined {
    if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : undefined;
    if (typeof value !== "string") return undefined;

    const trimmed = value.trim();
    if (!trimmed) return undefined;

    const numericValue = Number(trimmed);
    if (Number.isFinite(numericValue) && numericValue > 0) return numericValue;

    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) ? parsed : trimmed;
}

function hashString(value: string) {
    let hash = 0;
    for (let index = 0; index < value.length; index += 1) {
        hash = (hash * 31 + value.charCodeAt(index)) % 4294967296;
    }
    return hash.toString(36);
}
