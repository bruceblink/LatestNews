import type { NewsItem, SourceID } from "@shared/types";
import type { NewsItemsNormalizationQuality } from "@shared/news-item-schema";

import { getters } from "#/getters";
import {
    getCrawlerSourceKind,
    fetchConfiguredSource,
    hasCrawlerPluginSource,
    fetchInstalledCrawlerSource,
    initializeCrawlerPluginCatalog,
} from "#/utils/crawler-plugin-runtime";

import { createSourceEngine } from "./source-engine";
import { recordSourceFailure, recordSourceQuality, recordSourceSuccess } from "./source-health";

import type { SourceAdapter } from "./source-engine";

export interface SourceFetcherQueueOptions {
    /** Maximum number of source collectors that may execute at the same time. */
    maxConcurrent?: number;
    /** Maximum number of source collectors allowed to wait for a slot. */
    maxQueued?: number;
    /** Maximum time a queued collector may wait before it is rejected. */
    queueTimeoutMs?: number;
}

interface CreateSourceFetcherOptions extends SourceFetcherQueueOptions {
    getItems: (id: SourceID) => Promise<NewsItem[]>;
    onSuccess: (id: SourceID, durationMs: number, itemCount: number) => void;
    onQuality?: (id: SourceID, quality: NewsItemsNormalizationQuality, sampledAt: number) => void;
    onFailure: (id: SourceID, durationMs: number, error: unknown) => void;
    now?: () => number;
}

export function hasSourceGetter(id: SourceID) {
    return typeof getters[id] === "function" || hasCrawlerPluginSource(id);
}

export const sourceFetcherQueueDefaults = {
    maxConcurrent: 8,
    maxQueued: 100,
    queueTimeoutMs: 8_000,
} as const satisfies Required<SourceFetcherQueueOptions>;

export function createSourceFetcher({
    getItems,
    onSuccess,
    onQuality,
    onFailure,
    now = Date.now,
    maxConcurrent = sourceFetcherQueueDefaults.maxConcurrent,
    maxQueued = sourceFetcherQueueDefaults.maxQueued,
    queueTimeoutMs = sourceFetcherQueueDefaults.queueTimeoutMs,
}: CreateSourceFetcherOptions) {
    const engine = createSourceEngine({
        resolveAdapter: (id): SourceAdapter => ({
            descriptor: { id, kind: "legacy" },
            collect: () => getItems(id),
        }),
        onSuccess,
        onQuality,
        onFailure,
        now,
        maxConcurrent,
        maxQueued,
        queueTimeoutMs,
    });

    return engine.collect;
}

const sourceEngine = createSourceEngine({
    adapters: createRegisteredSourceAdapters(),
    resolveAdapter: (id) => {
        const crawlerSourceKind = getCrawlerSourceKind(id);
        if (crawlerSourceKind) {
            return {
                descriptor: { id, kind: crawlerSourceKind },
                collect: async () =>
                    (await (crawlerSourceKind === "plugin"
                        ? fetchInstalledCrawlerSource(id)
                        : fetchConfiguredSource(id))) ?? [],
            } satisfies SourceAdapter;
        }

        if (typeof getters[id] === "function") {
            return {
                descriptor: { id, kind: "legacy" },
                collect: () => getters[id](),
            } satisfies SourceAdapter;
        }

        return undefined;
    },
    onSuccess: recordSourceSuccess,
    onQuality: recordSourceQuality,
    onFailure: recordSourceFailure,
});

export const fetchSourceItems = sourceEngine.collect;

function createRegisteredSourceAdapters(): SourceAdapter[] {
    const runtimeAdapters = initializeCrawlerPluginCatalog().flatMap((source) => {
        const id = source.id as SourceID;
        const kind = getCrawlerSourceKind(id);
        if (!kind) return [];

        return [
            {
                descriptor: { id, kind },
                collect: async () =>
                    (await (kind === "plugin" ? fetchInstalledCrawlerSource(id) : fetchConfiguredSource(id))) ?? [],
            } satisfies SourceAdapter,
        ];
    });
    const runtimeIds = new Set(runtimeAdapters.map(({ descriptor }) => descriptor.id));
    const legacyAdapters = Object.entries(getters).flatMap(([id, getter]) => {
        const sourceId = id as SourceID;
        if (runtimeIds.has(sourceId) || typeof getter !== "function") return [];
        return [
            {
                descriptor: { id: sourceId, kind: "legacy" as const },
                collect: () => getter(),
            } satisfies SourceAdapter,
        ];
    });

    return [...runtimeAdapters, ...legacyAdapters];
}
