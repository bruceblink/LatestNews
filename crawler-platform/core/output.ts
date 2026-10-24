import { z } from "zod";

import { CrawlerPlatformError } from "./errors";

import type { CrawlerItem, CrawlerSourceKey } from "../sdk/types";

const MAX_ITEMS = 30;
const MAX_RESULT_BYTES = 256 * 1024;
const TRACKING_PARAMETER = /^(utm_.+|fbclid|gclid|igshid|yclid|spm|from|ref|source|share)$/i;

const itemSchema = z
    .object({
        id: z.union([z.string().trim().min(1).max(160), z.number().finite()]).optional(),
        title: z.string().trim().min(1).max(500),
        url: z.string().trim().min(1).max(4096).url().refine(isHttpUrl),
        mobileUrl: z.string().trim().min(1).max(4096).url().refine(isHttpUrl).optional(),
        publishedAt: z.union([z.number().finite(), z.string().trim().min(1).max(128)]).optional(),
        extra: z
            .object({
                hover: z.string().max(8192).optional(),
                date: z.union([z.number().finite(), z.string().trim().min(1).max(128)]).optional(),
                info: z.union([z.literal(false), z.string().max(1024)]).optional(),
                diff: z.number().finite().optional(),
                icon: z
                    .union([
                        z.literal(false),
                        z.string().trim().min(1).max(4096),
                        z
                            .object({
                                url: z.string().trim().min(1).max(4096),
                                scale: z.number().finite().min(0).max(10),
                            })
                            .strict(),
                    ])
                    .optional(),
            })
            .strict()
            .optional(),
    })
    .strict();

export interface NormalizeCrawlerItemsOptions {
    sourceKey: CrawlerSourceKey;
    maxItems?: number;
    maxBytes?: number;
}

/** Validate plugin output, normalize URLs, and cap result size at the host boundary. */
export function normalizeCrawlerItems(input: unknown, options: NormalizeCrawlerItemsOptions): CrawlerItem[] {
    if (!Array.isArray(input)) {
        throw new CrawlerPlatformError("INVALID_OUTPUT", "A crawler must return an array of items.");
    }

    const limit = Math.min(options.maxItems ?? MAX_ITEMS, MAX_ITEMS);
    const maxBytes = options.maxBytes ?? MAX_RESULT_BYTES;
    const items: CrawlerItem[] = [];
    const seenUrls = new Set<string>();

    for (let index = 0; index < input.length && items.length < limit; index += 1) {
        const parsed = itemSchema.safeParse(input[index]);
        if (!parsed.success) {
            const details = parsed.error.issues
                .map((issue) => `${issue.path.join(".") || "item"}: ${issue.message}`)
                .join("; ");
            throw new CrawlerPlatformError("INVALID_OUTPUT", `Item ${index} is invalid: ${details}`);
        }

        const url = normalizeCrawlerUrl(parsed.data.url);
        if (seenUrls.has(url)) continue;
        seenUrls.add(url);

        items.push({
            id: parsed.data.id ?? createStableId(options.sourceKey, url),
            title: parsed.data.title,
            url,
            ...(parsed.data.mobileUrl ? { mobileUrl: normalizeCrawlerUrl(parsed.data.mobileUrl) } : {}),
            ...(parsed.data.publishedAt !== undefined ? { publishedAt: parsed.data.publishedAt } : {}),
            ...(parsed.data.extra ? { extra: parsed.data.extra } : {}),
        });
    }

    const byteLength = new TextEncoder().encode(JSON.stringify(items)).byteLength;
    if (byteLength > maxBytes) {
        throw new CrawlerPlatformError("INVALID_OUTPUT", `Crawler output exceeds the ${maxBytes}-byte limit.`);
    }

    return items;
}

/** Remove fragment and known tracking parameters while preserving content-bearing query parameters. */
export function normalizeCrawlerUrl(value: string): string {
    const url = new URL(value);
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    for (const key of [...url.searchParams.keys()]) {
        if (TRACKING_PARAMETER.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    if (url.pathname.length > 1 && url.pathname.endsWith("/")) url.pathname = url.pathname.slice(0, -1);
    return url.href;
}

function isHttpUrl(value: string) {
    try {
        const url = new URL(value);
        return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password;
    } catch {
        return false;
    }
}

function createStableId(sourceKey: CrawlerSourceKey, url: string) {
    const input = `${sourceKey}\0${url}`;
    let hash = 0;
    for (let index = 0; index < input.length; index += 1) {
        hash = (hash * 31 + input.charCodeAt(index)) % 4294967296;
    }
    return `${sourceKey}:${hash.toString(36)}`;
}
