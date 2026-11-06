import type { NewsItem, SourceID } from "@shared/types";
import type { NewsItemsNormalizationQuality } from "@shared/news-item-schema";

import { getters } from "#/getters";
import { hasCrawlerPluginSource, fetchCrawlerPluginSource } from "#/utils/crawler-plugin-runtime";

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
    resolveAdapter: (id) => {
        if (hasCrawlerPluginSource(id)) {
            return {
                descriptor: { id, kind: "plugin" },
                collect: async () => (await fetchCrawlerPluginSource(id)) ?? [],
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
