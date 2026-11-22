import type { NewsItem, SourceID } from "@shared/types";

export function getCrawlerSourceKind(_id: SourceID): undefined {
    return undefined;
}

/** Pages has no local Node plugin host, so its catalog remains static. */
export function initializeCrawlerPluginCatalog() {
    return [];
}

export async function fetchInstalledCrawlerSource(
    _id: SourceID,
    _signal?: AbortSignal
): Promise<NewsItem[] | undefined> {
    return undefined;
}

export async function fetchConfiguredSource(_id: SourceID, _signal?: AbortSignal): Promise<NewsItem[] | undefined> {
    return undefined;
}

export function disposeCrawlerPluginRuntime() {}
