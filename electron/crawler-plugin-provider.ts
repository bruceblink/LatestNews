import { app } from "electron";
import process from "node:process";
import { join, resolve } from "node:path";

import dataSources from "../shared/data-sources";
import { CrawlerCacheStore } from "./crawler-cache";
import { createElectronCrawlerHost } from "./crawler-host";
import { readEnabledCrawlerPluginIds } from "../crawler-platform/host/plugin-store";
import { createCrawlerPluginProvider } from "../crawler-platform/host/plugin-provider";
import { registerRuntimeSourceCatalog, createRuntimeSourceMetadataItem } from "../shared/runtime-source-catalog";

import type { CrawlerItem } from "../crawler-platform/sdk/types";
import type { ElectronCrawlerHostOptions } from "./crawler-host";
import type { NewsItem, SourceID, SourceResponse } from "../shared/types";

export interface ElectronCrawlerPluginRuntimeOptions {
    userDataPath?: string;
    cachePath?: string;
    workerPath?: string;
    requestHandler?: ElectronCrawlerHostOptions["requestHandler"];
}

/** Read operator-enabled package IDs and keep invalid local settings from blocking remote reading. */
export async function createElectronCrawlerPluginRuntime(options: ElectronCrawlerPluginRuntimeOptions = {}) {
    const userDataPath = options.userDataPath ?? app.getPath("userData");
    const configuredPluginRoot = process.env.LATESTNEWS_CRAWLER_PLUGIN_DIR?.trim();
    const pluginRoot = configuredPluginRoot ? resolve(configuredPluginRoot) : join(userDataPath, "crawler-plugins");
    const enabledPluginIds = readEnabledPluginIds(join(pluginRoot, "enabled.json"));
    const workerPath =
        options.workerPath ??
        (app.isPackaged
            ? join(process.resourcesPath, "crawler-platform", "runtime", "worker-entry.mjs")
            : resolve(process.cwd(), "crawler-platform", "runtime", "worker-entry.mjs"));

    try {
        const provider = createCrawlerPluginProvider({
            pluginDirectory: join(pluginRoot, "packages"),
            enabledPluginIds,
            acceptedSourceIds: new Set(Object.keys(dataSources)),
            target: "electron",
            workerPath,
            maxConcurrent: 2,
            maxQueued: 24,
            queueTimeoutMs: 15000,
            createHost: () =>
                createElectronCrawlerHost({
                    workerPath,
                    timeoutMs: 15000,
                    ...(options.requestHandler ? { requestHandler: options.requestHandler } : {}),
                }),
        });
        const sourceMetadata = registerRuntimeSourceCatalog(
            provider.listSources().map(createRuntimeSourceMetadataItem)
        );
        const sourceInfo = new Map(provider.listSources().map((source) => [source.id, source]));
        const cache = new CrawlerCacheStore({
            path: options.cachePath ?? join(userDataPath, "crawler-cache.json"),
        });

        return {
            listSourceIds: provider.listSourceIds,
            listSourceMetadata: () => sourceMetadata,
            dispose: () => provider.dispose(),
            async fetchSource(sourceId: SourceID): Promise<SourceResponse | null> {
                const info = sourceInfo.get(sourceId);
                try {
                    const items = await provider.collect(sourceId);
                    if (!items) return null;
                    const updatedTime = Date.now();
                    const response: SourceResponse = {
                        status: items.length ? "success" : "empty",
                        id: sourceId,
                        name: dataSources[sourceId]?.name ?? info?.name ?? sourceId,
                        updatedTime,
                        items: items.map(toNewsItem),
                    };
                    if (response.items.length > 0) {
                        await cache.write(sourceId, response.items, updatedTime).catch((error: unknown) => {
                            console.warn("Desktop crawler cache write failed.", error);
                        });
                    }
                    return response;
                } catch (error) {
                    const cached = await cache.read(sourceId);
                    if (!cached) throw error;
                    const interval = info?.interval ?? 600_000;
                    const age = Math.max(0, Date.now() - cached.updatedTime);
                    return {
                        status: age >= interval * 2 ? "stale-cache" : "degraded-cache",
                        id: sourceId,
                        name: dataSources[sourceId]?.name ?? info?.name ?? sourceId,
                        updatedTime: cached.updatedTime,
                        items: cached.items,
                    };
                }
            },
        };
    } catch (error) {
        console.warn(
            "Desktop local crawler plugins were disabled.",
            error instanceof Error ? error.message : "Invalid settings."
        );
        return {
            listSourceIds: () => [],
            listSourceMetadata: () => [],
            fetchSource: async () => null,
        };
    }
}

export type ElectronCrawlerPluginRuntime = Awaited<ReturnType<typeof createElectronCrawlerPluginRuntime>>;

function readEnabledPluginIds(path: string) {
    try {
        return readEnabledCrawlerPluginIds(path);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            console.warn("Desktop crawler plugin settings could not be read; local plugins remain disabled.");
        }
        return [];
    }
}

function toNewsItem(item: CrawlerItem): NewsItem {
    return {
        id: item.id,
        title: item.title,
        url: item.url,
        ...(item.mobileUrl ? { mobileUrl: item.mobileUrl } : {}),
        ...(item.publishedAt !== undefined ? { pubDate: item.publishedAt } : {}),
        ...(item.extra ? { extra: item.extra } : {}),
    };
}
