import { z } from "zod";
import { app } from "electron";
import process from "node:process";
import { join, resolve } from "node:path";
import { readFile } from "node:fs/promises";

import dataSources from "../shared/data-sources";
import { createElectronCrawlerHost } from "./crawler-host";
import { createCrawlerPluginProvider } from "../crawler-platform/host/plugin-provider";

import type { CrawlerItem } from "../crawler-platform/sdk/types";
import type { ElectronCrawlerHostOptions } from "./crawler-host";
import type { NewsItem, SourceID, SourceResponse } from "../shared/types";

export interface ElectronCrawlerPluginRuntimeOptions {
    userDataPath?: string;
    workerPath?: string;
    requestHandler?: ElectronCrawlerHostOptions["requestHandler"];
}

const enabledPluginsSchema = z
    .object({
        enabledPluginIds: z.array(z.string().min(3).max(120)).max(256),
    })
    .strict();

/** Read operator-enabled package IDs and keep invalid local settings from blocking remote reading. */
export async function createElectronCrawlerPluginRuntime(options: ElectronCrawlerPluginRuntimeOptions = {}) {
    const configuredPluginRoot = process.env.LATESTNEWS_CRAWLER_PLUGIN_DIR?.trim();
    const pluginRoot = configuredPluginRoot
        ? resolve(configuredPluginRoot)
        : join(options.userDataPath ?? app.getPath("userData"), "crawler-plugins");
    const enabledPluginIds = await readEnabledPluginIds(join(pluginRoot, "enabled.json"));
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

        return {
            listSourceIds: provider.listSourceIds,
            async fetchSource(sourceId: SourceID): Promise<SourceResponse | null> {
                const items = await provider.collect(sourceId);
                if (!items) return null;
                return {
                    status: items.length ? "success" : "empty",
                    id: sourceId,
                    name: dataSources[sourceId].name,
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
            fetchSource: async () => null,
        };
    }
}

export type ElectronCrawlerPluginRuntime = Awaited<ReturnType<typeof createElectronCrawlerPluginRuntime>>;

async function readEnabledPluginIds(path: string) {
    try {
        const parsed = enabledPluginsSchema.safeParse(JSON.parse(await readFile(path, "utf8")) as unknown);
        if (!parsed.success) {
            console.warn("Desktop crawler plugin settings are invalid; local plugins remain disabled.");
            return [];
        }
        return parsed.data.enabledPluginIds;
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
    };
}
