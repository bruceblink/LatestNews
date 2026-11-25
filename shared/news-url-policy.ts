/** Validate a navigable article URL, not a server-side fetch destination. */
export const MAX_NEWS_URL_LENGTH = 4096;

export function hasInvalidNewsUrlCharacters(value: string): boolean {
    return /[\x00-\x1f\x7f\\]/u.test(value);
}

export function safeNewsUrl(value: unknown): string | undefined {
    if (typeof value !== "string" || value.length > MAX_NEWS_URL_LENGTH || hasInvalidNewsUrlCharacters(value))
        return undefined;
    const trimmed = value.trim();
    // Do not allow relative URLs or the WHATWG parser's implicit slash repairs.
    if (!/^https?:\/\/[^/\s]/i.test(trimmed) || /\s/u.test(trimmed) || /^https?:\/\/[^/?#]*@/i.test(trimmed))
        return undefined;
    try {
        const url = new URL(trimmed);
        if (
            (url.protocol !== "https:" && url.protocol !== "http:") ||
            !url.hostname ||
            url.username ||
            url.password ||
            url.href.length > MAX_NEWS_URL_LENGTH
        )
            return undefined;
        // Preserve the caller's URL representation and existing article identity.
        return trimmed;
    } catch {
        return undefined;
    }
}

/** Unsafe primary URLs cannot identify an article. An unsafe optional mobile URL is dropped. */
export function safeNewsItemLinks<T extends { url: string; mobileUrl?: string | null }>(item: T): T | undefined {
    if (!item || typeof item !== "object") return undefined;
    const url = safeNewsUrl(item.url);
    if (!url) return undefined;
    const mobileUrl = safeNewsUrl(item.mobileUrl);
    if (url === item.url && mobileUrl === item.mobileUrl) return item;
    const result = { ...item, url };
    if (mobileUrl) result.mobileUrl = mobileUrl;
    else delete result.mobileUrl;
    return result;
}

export function filterSafeNewsItemLinks<T extends { url: string; mobileUrl?: string | null }>(items: T[]): T[] {
    return items.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const safe = safeNewsItemLinks(item);
        return safe ? [safe] : [];
    });
}

/** Do not navigate via an optional URL unless the primary article URL is also valid. */
export function newsLinkHref(url: unknown, preferredUrl?: unknown): string | undefined {
    const primary = safeNewsUrl(url);
    return primary ? (safeNewsUrl(preferredUrl) ?? primary) : undefined;
}
