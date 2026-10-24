import { app } from "electron";
import process from "node:process";
import { join, resolve } from "node:path";

import dataSources from "../shared/data-sources";
import { createElectronCrawlerHost } from "./crawler-host";
import { readEnabledCrawlerPluginIds } from "../crawler-platform/host/plugin-store";
import { createCrawlerPluginProvider } from "../crawler-platform/host/plugin-provider";
import { registerRuntimeSourceCatalog, createRuntimeSourceMetadataItem } from "../shared/runtime-source-catalog";

import type { CrawlerItem } from "../crawler-platform/sdk/types";
import type { ElectronCrawlerHostOptions } from "./crawler-host";
import type { NewsItem, SourceID, SourceResponse } from "../shared/types";

export interface ElectronCrawlerPluginRuntimeOptions {
    userDataPath?: string;
    workerPath?: string;
    requestHandler?: ElectronCrawlerHostOptions["requestHandler"];
}

/** Read operator-enabled package IDs and keep invalid local settings from blocking remote reading. */
export async function createElectronCrawlerPluginRuntime(options: ElectronCrawlerPluginRuntimeOptions = {}) {
    const configuredPluginRoot = process.env.LATESTNEWS_CRAWLER_PLUGIN_DIR?.trim();
    const pluginRoot = configuredPluginRoot
        ? resolve(configuredPluginRoot)
        : join(options.userDataPath ?? app.getPath("userData"), "crawler-plugins");
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
        const sourceNames = new Map(provider.listSources().map((source) => [source.id, source.name]));

        return {
            listSourceIds: provider.listSourceIds,
            listSourceMetadata: () => sourceMetadata,
            dispose: () => provider.dispose(),
            async fetchSource(sourceId: SourceID): Promise<SourceResponse | null> {
                const items = await provider.collect(sourceId);
                if (!items) return null;
                return {
                    status: items.length ? "success" : "empty",
                    id: sourceId,
                    name: dataSources[sourceId]?.name ?? sourceNames.get(sourceId) ?? sourceId,
                    updatedTime: Date.now(),
                    items: items.map(toNewsItem),
                };
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
