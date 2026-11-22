import type { NewsItem, SourceID } from "@shared/types";
import type { SourceDescriptor } from "@shared/source-adapter";
import type { NewsItemsNormalizationQuality } from "@shared/news-item-schema";

import { normalizeNewsItemsWithQuality } from "@shared/news-item-schema";

import { CrawlerPlatformError } from "../../crawler-platform/core/errors";
import { createCrawlerTaskQueue } from "../../crawler-platform/host/task-queue";

export interface SourceExecutionContext {
    sourceId: SourceID;
    signal: AbortSignal;
    now(): number;
}

export interface SourceAdapter {
    descriptor: SourceDescriptor;
    collect(context: SourceExecutionContext): Promise<unknown>;
}

export interface SourceEngineQueueOptions {
    maxConcurrent?: number;
    maxQueued?: number;
    queueTimeoutMs?: number;
}

export interface SourceEngineOptions extends SourceEngineQueueOptions {
    adapters?: readonly SourceAdapter[];
    resolveAdapter?: (id: SourceID) => SourceAdapter | undefined;
    onSuccess: (id: SourceID, durationMs: number, itemCount: number) => void;
    onQuality?: (id: SourceID, quality: NewsItemsNormalizationQuality, sampledAt: number) => void;
    onFailure: (id: SourceID, durationMs: number, error: unknown) => void;
    onAdapter?: (id: SourceID, descriptor: SourceDescriptor) => void;
    now?: () => number;
}

export interface SourceCollectOptions {
    signal?: AbortSignal;
}

interface SourceCollection {
    controller: AbortController;
    result: Promise<NewsItem[]>;
    callers: number;
}

/**
 * Shared source execution boundary for legacy getters, trusted plugins and configured sources.
 * Adapters own collection details; the engine owns scheduling, normalization and health hooks.
 */
export function createSourceEngine({
    adapters: initialAdapters = [],
    resolveAdapter,
    onSuccess,
    onQuality,
    onFailure,
    onAdapter,
    now = Date.now,
    maxConcurrent = 8,
    maxQueued = 100,
    queueTimeoutMs = 8_000,
}: SourceEngineOptions) {
    const adapters = new Map<SourceID, SourceAdapter>();
    for (const adapter of initialAdapters) {
        registerAdapter(adapter);
    }
    const inflightRequests = new Map<SourceID, SourceCollection>();
    const queue = createCrawlerTaskQueue({ maxConcurrent, maxQueued, queueTimeoutMs });
    let closed = false;

    return {
        collect,
        close() {
            if (closed) return;
            closed = true;
            queue.close();
            for (const { controller } of inflightRequests.values()) controller.abort();
        },
        hasSource(id: SourceID) {
            return Boolean(adapters.get(id) ?? resolveAdapter?.(id));
        },
        register(adapter: SourceAdapter) {
            registerAdapter(adapter);
        },
        listDescriptors(): SourceDescriptor[] {
            return [...adapters.values()].map(({ descriptor }) => descriptor);
        },
    };

    function collect(id: SourceID, { signal }: SourceCollectOptions = {}): Promise<NewsItem[]> {
        if (closed || signal?.aborted) return Promise.reject(cancelledCollection(id));

        const pending = inflightRequests.get(id);
        const collection = pending && !pending.controller.signal.aborted ? pending : startCollection(id);
        // A caller without a signal keeps the collection alive until the source settles.
        collection.callers += 1;
        if (!signal) return collection.result;

        return new Promise((resolve, reject) => {
            const onAbort = () => {
                collection.callers -= 1;
                if (!collection.callers) collection.controller.abort();
                reject(cancelledCollection(id));
            };
            signal.addEventListener("abort", onAbort, { once: true });
            void collection.result.then(
                (items) => {
                    signal.removeEventListener("abort", onAbort);
                    resolve(items);
                },
                (error) => {
                    signal.removeEventListener("abort", onAbort);
                    reject(error);
                }
            );
        });
    }

    function startCollection(id: SourceID): SourceCollection {
        const controller = new AbortController();
        const startTime = now();
        const result = queue
            .run(async (signal) => {
                const adapter = adapters.get(id) ?? resolveAdapter?.(id);
                if (!adapter) throw new Error(`Source ${id} is not registered.`);
                onAdapter?.(id, adapter.descriptor);
                return adapter.collect({ sourceId: id, signal, now });
            }, controller.signal)
            .then((items) => {
                if (controller.signal.aborted) throw cancelledCollection(id);
                if (!Array.isArray(items)) throw new Error(`Source ${id} returned a non-array result.`);
                const normalized = normalizeNewsItemsWithQuality(items, { sourceId: id });
                const completedAt = now();
                onSuccess(id, completedAt - startTime, normalized.items.length);
                onQuality?.(id, normalized.quality, completedAt);
                return normalized.items;
            })
            .catch((error: unknown) => {
                if (controller.signal.aborted) throw cancelledCollection(id);
                if (!isCancellationError(error)) onFailure(id, now() - startTime, error);
                throw error;
            })
            .finally(() => {
                if (inflightRequests.get(id) === collection) inflightRequests.delete(id);
            });

        const collection = { controller, result, callers: 0 };
        inflightRequests.set(id, collection);
        return collection;
    }

    function registerAdapter(adapter: SourceAdapter) {
        const existing = adapters.get(adapter.descriptor.id);
        if (existing && existing !== adapter) {
            throw new Error(`Source ${adapter.descriptor.id} is already registered.`);
        }
        adapters.set(adapter.descriptor.id, adapter);
    }
}

function cancelledCollection(id: SourceID) {
    return new CrawlerPlatformError("CANCELLED", `Collection for ${id} was cancelled.`);
}

export function isCancellationError(error: unknown) {
    return typeof error === "object" && error !== null && "code" in error && error.code === "CANCELLED";
}
