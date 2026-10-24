import type { NewsItem, SourceID } from "@shared/types";
import type { NewsItemsNormalizationQuality } from "@shared/news-item-schema";

import { getters } from "#/getters";
import { normalizeNewsItemsWithQuality } from "@shared/news-item-schema";
import { hasCrawlerPluginSource, fetchCrawlerPluginSource } from "#/utils/crawler-plugin-runtime";

import { createCrawlerTaskQueue } from "../../crawler-platform/host/task-queue";
import { recordSourceFailure, recordSourceQuality, recordSourceSuccess } from "./source-health";

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
    const inflightRequests = new Map<SourceID, Promise<NewsItem[]>>();
    const queue = createCrawlerTaskQueue({ maxConcurrent, maxQueued, queueTimeoutMs });

    return function fetchSourceItems(id: SourceID) {
        const pending = inflightRequests.get(id);
        if (pending) return pending;

        const startTime = now();
        const request = queue
            .run(() => getItems(id))
            .then((items) => {
                const normalized = normalizeNewsItemsWithQuality(items, { sourceId: id });
                const completedAt = now();
                onSuccess(id, completedAt - startTime, normalized.items.length);
                onQuality?.(id, normalized.quality, completedAt);
                return normalized.items;
            })
            .catch((error) => {
                onFailure(id, now() - startTime, error);
                throw error;
            })
            .finally(() => {
                inflightRequests.delete(id);
            });

        inflightRequests.set(id, request);
        return request;
    };
}

export const fetchSourceItems = createSourceFetcher({
    getItems: async (id) => {
        const pluginItems = await fetchCrawlerPluginSource(id);
        return pluginItems ?? getters[id]();
    },
    onSuccess: recordSourceSuccess,
    onQuality: recordSourceQuality,
    onFailure: recordSourceFailure,
});
