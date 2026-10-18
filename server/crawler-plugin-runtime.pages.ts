import type { NewsItem, SourceID } from "@shared/types";

export function hasCrawlerPluginSource(_id: SourceID) {
    return false;
}

export async function fetchCrawlerPluginSource(_id: SourceID): Promise<NewsItem[] | undefined> {
    return undefined;
}
