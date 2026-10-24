import type { NewsItem, SourceID } from "@shared/types";

import process from "node:process";
import { resolve } from "node:path";

import { dataSources } from "../shared/data-sources";
import { readEnabledCrawlerPluginIds } from "../crawler-platform/host/plugin-store";
import { createNodeCrawlerPluginProvider } from "../crawler-platform/host/node-plugin-provider";
import { registerRuntimeSourceCatalog, createRuntimeSourceMetadataItem } from "../shared/runtime-source-catalog";

import type { NodeCrawlerPluginProviderOptions } from "../crawler-platform/host/node-plugin-provider";

const environmentPluginIds = (process.env.LATESTNEWS_CRAWLER_PLUGIN_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
const configuredPluginDirectory = process.env.LATESTNEWS_CRAWLER_PLUGIN_DIR?.trim();
const pluginDirectory = resolve(configuredPluginDirectory || ".data/crawler-plugins");
let enabledPluginIds = environmentPluginIds;
if (enabledPluginIds.length === 0) {
    try {
        enabledPluginIds = readEnabledCrawlerPluginIds(resolve(pluginDirectory, "enabled.json"));
    } catch (error) {
        console.warn(
            "Node crawler plugin settings are invalid; local plugins remain disabled.",
            error instanceof Error ? error.message : "Invalid settings."
        );
        enabledPluginIds = [];
    }
}

const pluginProvider =
    enabledPluginIds.length > 0
        ? createServerCrawlerPluginRuntime({
              pluginDirectory,
              enabledPluginIds,
              acceptedSourceIds: new Set(Object.keys(dataSources)),
              workerPath: resolve(process.cwd(), "crawler-platform/runtime/worker-entry.mjs"),
          })
        : undefined;

if (pluginProvider) {
    registerRuntimeSourceCatalog(pluginProvider.listSources().map(createRuntimeSourceMetadataItem));
}

/** Keep plugin loading configurable so the server adapter can be tested with offline responses. */
export function createServerCrawlerPluginRuntime(options: NodeCrawlerPluginProviderOptions) {
    const provider = createNodeCrawlerPluginProvider(options);
    return {
        hasSource: provider.hasSource,
        listSourceIds: provider.listSourceIds,
        listSources: provider.listSources,
        dispose: () => provider.dispose(),
        async fetchSource(id: SourceID): Promise<NewsItem[] | undefined> {
            const items = await provider.collect(id);
            if (!items) return undefined;
            return items.map((item) => ({
                id: item.id,
                title: item.title,
                url: item.url,
                ...(item.mobileUrl ? { mobileUrl: item.mobileUrl } : {}),
                ...(item.publishedAt !== undefined ? { pubDate: item.publishedAt } : {}),
                ...(item.extra ? { extra: item.extra } : {}),
            }));
        },
    };
}

export function hasCrawlerPluginSource(id: SourceID) {
    return pluginProvider?.hasSource(id) ?? false;
}

/** Ensure Node plugin metadata is registered before source discovery and resolution. */
export function initializeCrawlerPluginCatalog() {
    return pluginProvider?.listSources() ?? [];
}

/** Adapt plugin output to the existing NewsItem shape used by caches and API responses. */
export async function fetchCrawlerPluginSource(id: SourceID): Promise<NewsItem[] | undefined> {
    return pluginProvider?.fetchSource(id);
}
