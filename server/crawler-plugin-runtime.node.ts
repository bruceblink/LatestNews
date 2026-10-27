import type { NewsItem, SourceID } from "@shared/types";

import process from "node:process";
import { resolve } from "node:path";

import { dataSources } from "../shared/data-sources";
import { createConfiguredSourceRuntime } from "./configured-source-runtime.node";
import { readEnabledCrawlerPluginIds } from "../crawler-platform/host/plugin-store";
import { createNodeCrawlerPluginProvider } from "../crawler-platform/host/node-plugin-provider";
import {
    clearRuntimeSourceCatalog,
    registerRuntimeSourceCatalog,
    createRuntimeSourceMetadataItem,
} from "../shared/runtime-source-catalog";

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

if (enabledPluginIds.includes("config")) {
    console.warn('Crawler plugin ID "config" is reserved; local crawler plugins remain disabled.');
    enabledPluginIds = [];
}

let pluginProvider: ReturnType<typeof createServerCrawlerPluginRuntime> | undefined;
if (enabledPluginIds.length > 0) {
    try {
        pluginProvider = createServerCrawlerPluginRuntime({
            pluginDirectory,
            enabledPluginIds,
            acceptedSourceIds: new Set(Object.keys(dataSources)),
            workerPath: resolve(process.cwd(), "crawler-platform/runtime/worker-entry.mjs"),
        });
    } catch (error) {
        console.warn(
            "Node crawler plugins are invalid and remain disabled; built-in sources stay available.",
            error instanceof Error ? error.message : "Invalid plugin settings."
        );
    }
}

let configuredSourceProvider: ReturnType<typeof createConfiguredSourceRuntime> | undefined;
const configuredSourceManifest = process.env.LATESTNEWS_CONFIGURED_SOURCES?.trim();
if (configuredSourceManifest) {
    try {
        configuredSourceProvider = createConfiguredSourceRuntime(
            configuredSourceManifest,
            process.env.LATESTNEWS_CONFIGURED_SOURCE_ALLOWED_HOSTS ?? ""
        );
    } catch (error) {
        console.warn(
            "Configured sources are invalid and remain disabled.",
            error instanceof Error ? error.message : "Invalid configuration."
        );
    }
}

const runtimeSourceDefinitions = [
    ...(pluginProvider?.listSources() ?? []),
    ...(configuredSourceProvider?.listSources() ?? []),
];
if (runtimeSourceDefinitions.length > 0) {
    try {
        registerRuntimeSourceCatalog(runtimeSourceDefinitions.map(createRuntimeSourceMetadataItem));
    } catch (error) {
        console.warn(
            "Crawler plugin source metadata conflicts; local crawler plugins remain disabled.",
            error instanceof Error ? error.message : "Invalid runtime source metadata."
        );
        pluginProvider?.dispose();
        pluginProvider = undefined;
        try {
            registerRuntimeSourceCatalog(
                (configuredSourceProvider?.listSources() ?? []).map(createRuntimeSourceMetadataItem)
            );
        } catch {
            configuredSourceProvider = undefined;
            clearRuntimeSourceCatalog();
        }
    }
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
    return (pluginProvider?.hasSource(id) ?? false) || (configuredSourceProvider?.hasSource(id) ?? false);
}

/** Ensure Node plugin and configured-source metadata is registered before discovery and resolution. */
export function initializeCrawlerPluginCatalog() {
    return [...(pluginProvider?.listSources() ?? []), ...(configuredSourceProvider?.listSources() ?? [])];
}

/** Adapt plugin output to the existing NewsItem shape used by caches and API responses. */
export async function fetchCrawlerPluginSource(id: SourceID): Promise<NewsItem[] | undefined> {
    if (pluginProvider?.hasSource(id)) return pluginProvider.fetchSource(id);
    return configuredSourceProvider?.fetchSource(id);
}
