import type { H3Event } from "h3";
import type { NewsItem, SourceID } from "@shared/types";
import type { NewsItemsNormalizationQuality } from "@shared/news-item-schema";

import process from "node:process";
import { getters } from "#/getters";
import { getRequestSourceHealthPersistence } from "#/database/source-health-events";
import {
    getCrawlerSourceKind,
    fetchConfiguredSource,
    disposeCrawlerPluginRuntime,
    fetchInstalledCrawlerSource,
} from "#/utils/crawler-plugin-runtime";

import { createSourceEngine, parseSourceConcurrency } from "./source-engine";
import { legacySourceSignal, createRequestFetchScheduler, runWithRequestFetchScheduler } from "./fetch";
import { recordSourceAdapter, recordSourceFailure, recordSourceQuality, recordSourceSuccess } from "./source-health";

import type { CollectionTrace } from "./collection-trace";
import type { SourceAdapter, SourceCollectOptions } from "./source-engine";

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
    trace?: CollectionTrace;
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
    trace,
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
        trace,
    });

    return engine.collect;
}

function createRuntimeSourceEngine(scheduler?: ReturnType<typeof createRequestFetchScheduler>) {
    return createSourceEngine({
        maxConcurrent: parseSourceConcurrency(process.env.LATESTNEWS_SOURCE_MAX_CONCURRENT),
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
                    collect: ({ signal }) =>
                        legacySourceSignal.run(signal, () =>
                            scheduler ? runWithRequestFetchScheduler(scheduler, getters[id]) : getters[id]()
                        ),
                } satisfies SourceAdapter;
            }

            return undefined;
        },
        onSuccess: recordSourceSuccess,
        onQuality: recordSourceQuality,
        onFailure: recordSourceFailure,
        onAdapter: (id, descriptor) => recordSourceAdapter(id, descriptor.kind),
    });
}

const sourceEngine = createRuntimeSourceEngine();
const requestEngines = new WeakMap<H3Event, ReturnType<typeof createRuntimeSourceEngine>>();

export function fetchSourceItems(id: SourceID, options: SourceCollectOptions & { event?: H3Event } = {}) {
    const { event, ...collectOptions } = options;
    const persistence = event?.req.runtime?.cloudflare ? getRequestSourceHealthPersistence(event) : undefined;
    let engine = sourceEngine;
    if (event && persistence) {
        const existing = requestEngines.get(event);
        engine = existing ?? createRuntimeSourceEngine(createRequestFetchScheduler());
        if (!existing) requestEngines.set(event, engine);
    }
    return engine.collect(id, {
        ...collectOptions,
        healthPersistence: persistence,
    });
}
export const hasSourceGetter = sourceEngine.hasSource;

export function setSourceCollectionTrace(trace?: CollectionTrace) {
    sourceEngine.setTrace(trace);
}

export function stopSourceCollection() {
    sourceEngine.close();
    disposeCrawlerPluginRuntime();
}
