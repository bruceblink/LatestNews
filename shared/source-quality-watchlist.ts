import type { SourceID } from "@shared/types";

export type SourceQualityWatchlistKind = "rss" | "json" | "html";

export interface SourceQualityWatchlistEntry {
    id: SourceID;
    kind: SourceQualityWatchlistKind;
    purpose: string;
}

/**
 * Stable, low-frequency sampling scope for the first source-quality window.
 * The list covers the migrated RSS, JSON, and HTML adapters plus common hot-list sources.
 */
export const sourceQualityWatchlist = [
    { id: "freebuf", kind: "rss", purpose: "RSS adapter" },
    { id: "juejin", kind: "json", purpose: "JSON adapter" },
    { id: "hackernews", kind: "html", purpose: "HTML adapter" },
    { id: "github", kind: "html", purpose: "HTML trending source" },
    { id: "ithome", kind: "html", purpose: "Chinese technology source" },
    { id: "sspai", kind: "html", purpose: "Technology editorial source" },
    { id: "thepaper", kind: "html", purpose: "News editorial source" },
    { id: "zhihu", kind: "html", purpose: "Hot-list source" },
    { id: "weibo", kind: "html", purpose: "Hot-search source" },
    { id: "bilibili-hot-search", kind: "json", purpose: "Official hot-search API" },
] as const satisfies readonly SourceQualityWatchlistEntry[];

export function getSourceQualityWatchlistEntry(sourceId: string) {
    return sourceQualityWatchlist.find((entry) => entry.id === sourceId);
}
