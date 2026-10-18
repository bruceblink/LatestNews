import type { NewsItem, SourceID } from "@shared/types";

export function hasCrawlerPluginSource(_id: SourceID) {
    return false;
}

/** Pages has no local Node plugin host, so its catalog remains static. */
export function initializeCrawlerPluginCatalog() {
    return [];
}

export async function fetchCrawlerPluginSource(_id: SourceID): Promise<NewsItem[] | undefined> {
    return undefined;
}
