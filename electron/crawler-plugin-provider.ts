import { app } from "electron";
import process from "node:process";
import { join, resolve } from "node:path";

import dataSources from "../shared/data-sources";
import { CrawlerCacheStore } from "./crawler-cache";
import { createElectronCrawlerHost } from "./crawler-host";
import { seedBuiltinCrawlerPlugins } from "./crawler-plugin-seeder";
import { readEnabledCrawlerPluginIds } from "../crawler-platform/host/plugin-store";
import { createCrawlerPluginProvider } from "../crawler-platform/host/plugin-provider";
import { registerRuntimeSourceCatalog, createRuntimeSourceMetadataItem } from "../shared/runtime-source-catalog";

import type { CrawlerItem } from "../crawler-platform/sdk/types";
import type { ElectronCrawlerHostOptions } from "./crawler-host";
import type { NewsItem, SourceID, SourceResponse } from "../shared/types";
import type { SourceHealthEvent, SourceHealthSummary, SourceHealthSnapshot } from "../shared/source-health-types";

const MAX_RECENT_HEALTH_EVENTS = 12;

interface LocalSourceHealthRecord {
    status: SourceHealthSnapshot["status"];
    successCount: number;
    errorCount: number;
    consecutiveFailures: number;
    cacheDegraded: boolean;
    lastDurationMs?: number;
    lastSuccessAt?: number;
    lastErrorAt?: number;
    lastErrorMessage?: string;
    lastItemCount?: number;
    recentEvents: SourceHealthEvent[];
}

export interface ElectronCrawlerPluginRuntimeOptions {
    userDataPath?: string;
    cachePath?: string;
    workerPath?: string;
    bundledPluginRoot?: string;
    requestHandler?: ElectronCrawlerHostOptions["requestHandler"];
}

/** Read operator-enabled package IDs and keep invalid local settings from blocking remote reading. */
export async function createElectronCrawlerPluginRuntime(options: ElectronCrawlerPluginRuntimeOptions = {}) {
    const userDataPath = options.userDataPath ?? app.getPath("userData");
    const configuredPluginRoot = process.env.LATESTNEWS_CRAWLER_PLUGIN_DIR?.trim();
    const pluginRoot = configuredPluginRoot ? resolve(configuredPluginRoot) : join(userDataPath, "crawler-plugins");
    // Explicit external stores remain operator-managed. Seeding failures must not block remote reading.
    if (!configuredPluginRoot) {
        const bundledPluginRoot =
            options.bundledPluginRoot ??
            (app.isPackaged
                ? join(process.resourcesPath, "crawler-platform", "builtin-plugins")
                : resolve(process.cwd(), "out", "crawler-platform", "builtin-plugins"));
        try {
            await seedBuiltinCrawlerPlugins(pluginRoot, bundledPluginRoot);
        } catch {
            console.warn("Desktop bundled crawler plugins could not be installed; existing settings remain in use.");
        }
    }
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
        const healthBySource = new Map<SourceID, LocalSourceHealthRecord>();
        const sampleWindowStartedAt = Date.now();

        const getHealthRecord = (sourceId: SourceID): LocalSourceHealthRecord => {
            let record = healthBySource.get(sourceId);
            if (!record) {
                record = {
                    status: "idle",
                    successCount: 0,
                    errorCount: 0,
                    consecutiveFailures: 0,
                    cacheDegraded: false,
                    recentEvents: [],
                };
                healthBySource.set(sourceId, record);
            }
            return record;
        };

        return {
            listSourceIds: provider.listSourceIds,
            listSourceMetadata: () => sourceMetadata,
            dispose: () => provider.dispose(),
            async getHealthSummary(): Promise<SourceHealthSummary> {
                const sources = await Promise.all(
                    provider.listSourceIds().map(async (sourceId): Promise<SourceHealthSnapshot> => {
                        // The provider returns only IDs admitted by the validated static catalog or plugin manifest.
                        const typedSourceId = sourceId as SourceID;
                        const record = getHealthRecord(typedSourceId);
                        const cached = await cache.read(typedSourceId).catch(() => undefined);
                        return {
                            id: typedSourceId,
                            name: dataSources[typedSourceId]?.name ?? sourceInfo.get(typedSourceId)?.name ?? sourceId,
                            status: record.status,
                            successCount: record.successCount,
                            errorCount: record.errorCount,
                            consecutiveFailures: record.consecutiveFailures,
                            cacheDegraded: record.cacheDegraded,
                            ...(record.lastDurationMs !== undefined ? { lastDurationMs: record.lastDurationMs } : {}),
                            ...((record.lastSuccessAt ?? cached?.updatedTime)
                                ? { lastSuccessAt: record.lastSuccessAt ?? cached?.updatedTime }
                                : {}),
                            ...(record.lastErrorAt !== undefined ? { lastErrorAt: record.lastErrorAt } : {}),
                            ...(record.lastErrorMessage ? { lastErrorMessage: record.lastErrorMessage } : {}),
                            ...(record.lastItemCount !== undefined || cached
                                ? { lastItemCount: record.lastItemCount ?? cached?.items.length ?? 0 }
                                : {}),
                            recentEvents: [...record.recentEvents],
                        };
                    })
                );
                const healthy = sources.filter((source) => source.status === "healthy").length;
                const failing = sources.filter((source) => source.status === "failing").length;
                const idle = sources.filter((source) => source.status === "idle").length;
                const cacheDegraded = sources.filter((source) => source.cacheDegraded).length;
                return {
                    updatedAt: Date.now(),
                    total: sources.length,
                    healthy,
                    failing,
                    idle,
                    cacheDegraded,
                    sampleWindowStartedAt,
                    sources,
                };
            },
            async fetchSource(sourceId: SourceID): Promise<SourceResponse | null> {
                const info = sourceInfo.get(sourceId);
                const startedAt = Date.now();
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
                    const previous = getHealthRecord(sourceId);
                    healthBySource.set(sourceId, {
                        ...previous,
                        status: "healthy",
                        successCount: previous.successCount + 1,
                        consecutiveFailures: 0,
                        cacheDegraded: false,
                        lastDurationMs: Math.max(0, updatedTime - startedAt),
                        lastSuccessAt: updatedTime,
                        lastItemCount: response.items.length,
                        recentEvents: appendHealthEvent(previous.recentEvents, {
                            status: "healthy",
                            occurredAt: updatedTime,
                            durationMs: Math.max(0, updatedTime - startedAt),
                            itemCount: response.items.length,
                        }),
                    });
                    return response;
                } catch (error) {
                    const cached = await cache.read(sourceId);
                    const failedAt = Date.now();
                    const previous = getHealthRecord(sourceId);
                    const errorMessage = sanitizeCrawlerHealthError(error);
                    const durationMs = Math.max(0, failedAt - startedAt);
                    healthBySource.set(sourceId, {
                        ...previous,
                        status: "failing",
                        errorCount: previous.errorCount + 1,
                        consecutiveFailures: previous.consecutiveFailures + 1,
                        cacheDegraded: Boolean(cached),
                        lastDurationMs: durationMs,
                        lastErrorAt: failedAt,
                        lastErrorMessage: errorMessage,
                        recentEvents: appendHealthEvent(previous.recentEvents, {
                            status: "failing",
                            occurredAt: failedAt,
                            durationMs,
                            errorMessage,
                        }),
                    });
                    if (!cached) throw error;
                    const interval = info?.interval ?? 600_000;
                    const age = Math.max(0, failedAt - cached.updatedTime);
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
            getHealthSummary: async (): Promise<SourceHealthSummary> => ({
                updatedAt: Date.now(),
                total: 0,
                healthy: 0,
                failing: 0,
                idle: 0,
                cacheDegraded: 0,
                sources: [],
            }),
            fetchSource: async () => null,
        };
    }
}

export type ElectronCrawlerPluginRuntime = Awaited<ReturnType<typeof createElectronCrawlerPluginRuntime>>;

function appendHealthEvent(events: SourceHealthEvent[], event: SourceHealthEvent) {
    return [...events, event].slice(-MAX_RECENT_HEALTH_EVENTS);
}

function sanitizeCrawlerHealthError(error: unknown) {
    const message = error instanceof Error ? error.message : "本地采集失败。";
    return (
        message
            .replace(/https?:\/\/[^\s"'<>]+/gi, "[上游地址]")
            .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [已隐藏]")
            .replace(/\b(token|authorization|cookie|password|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, "$1=[已隐藏]")
            .replace(/[\r\n\t]+/g, " ")
            .trim()
            .slice(0, 240) || "本地采集失败。"
    );
}

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
