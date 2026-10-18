import type { NewsItem, SourceID } from "@shared/types";

import process from "node:process";
import { resolve } from "node:path";

import { dataSources } from "../shared/data-sources";
import { createNodeCrawlerPluginProvider } from "../crawler-platform/host/node-plugin-provider";

import type { NodeCrawlerPluginProviderOptions } from "../crawler-platform/host/node-plugin-provider";

const enabledPluginIds = (process.env.LATESTNEWS_CRAWLER_PLUGIN_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
const configuredPluginDirectory = process.env.LATESTNEWS_CRAWLER_PLUGIN_DIR?.trim();

const pluginProvider =
    enabledPluginIds.length > 0
        ? createServerCrawlerPluginRuntime({
              pluginDirectory: resolve(configuredPluginDirectory || ".data/crawler-plugins"),
              enabledPluginIds,
              acceptedSourceIds: new Set(Object.keys(dataSources)),
              workerPath: resolve(process.cwd(), "crawler-platform/runtime/worker-entry.mjs"),
          })
        : undefined;

/** Keep plugin loading configurable so the server adapter can be tested with offline responses. */
export function createServerCrawlerPluginRuntime(options: NodeCrawlerPluginProviderOptions) {
    const provider = createNodeCrawlerPluginProvider(options);
    return {
        hasSource: provider.hasSource,
        listSourceIds: provider.listSourceIds,
        async fetchSource(id: SourceID): Promise<NewsItem[] | undefined> {
            const items = await provider.collect(id);
            if (!items) return undefined;
            return items.map((item) => ({
                id: item.id,
                title: item.title,
                url: item.url,
                ...(item.mobileUrl ? { mobileUrl: item.mobileUrl } : {}),
                ...(item.publishedAt !== undefined ? { pubDate: item.publishedAt } : {}),
            }));
        },
    };
}

export function hasCrawlerPluginSource(id: SourceID) {
    return pluginProvider?.hasSource(id) ?? false;
}

/** Adapt plugin output to the existing NewsItem shape used by caches and API responses. */
export async function fetchCrawlerPluginSource(id: SourceID): Promise<NewsItem[] | undefined> {
    return pluginProvider?.fetchSource(id);
}
