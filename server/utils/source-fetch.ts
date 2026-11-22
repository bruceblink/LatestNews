import type { NewsItem, SourceID } from "@shared/types";
import type { NewsItemsNormalizationQuality } from "@shared/news-item-schema";

import { getters } from "#/getters";
import {
    getCrawlerSourceKind,
    fetchConfiguredSource,
    disposeCrawlerPluginRuntime,
    fetchInstalledCrawlerSource,
} from "#/utils/crawler-plugin-runtime";

import { legacySourceSignal } from "./fetch";
import { createSourceEngine } from "./source-engine";
import { recordSourceAdapter, recordSourceFailure, recordSourceQuality, recordSourceSuccess } from "./source-health";

import type { SourceAdapter } from "./source-engine";

interface SourceFetcherQueueOptions {
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

export function createSourceFetcher({
    getItems,
    onSuccess,
    onQuality,
    onFailure,
    now,
    maxConcurrent,
    maxQueued,
    queueTimeoutMs,
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
        const crawlerSourceKind = getCrawlerSourceKind(id);
        if (crawlerSourceKind) {
            return {
                descriptor: { id, kind: crawlerSourceKind },
                collect: async ({ signal }) =>
                    (await (crawlerSourceKind === "plugin"
                        ? fetchInstalledCrawlerSource(id, signal)
                        : fetchConfiguredSource(id, signal))) ?? [],
            } satisfies SourceAdapter;
        }

        if (typeof getters[id] === "function") {
            return {
                descriptor: { id, kind: "legacy" },
                collect: ({ signal }) => legacySourceSignal.run(signal, getters[id]),
            } satisfies SourceAdapter;
        }

        return undefined;
    },
    onSuccess: recordSourceSuccess,
    onQuality: recordSourceQuality,
    onFailure: recordSourceFailure,
    onAdapter: (id, descriptor) => recordSourceAdapter(id, descriptor.kind),
});

export const fetchSourceItems = sourceEngine.collect;
export const hasSourceGetter = sourceEngine.hasSource;

export function stopSourceCollection() {
    sourceEngine.close();
    disposeCrawlerPluginRuntime();
}
