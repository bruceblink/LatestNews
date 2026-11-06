import type { NewsItem, SourceID } from "@shared/types";
import type { NewsItemsNormalizationQuality } from "@shared/news-item-schema";

import { normalizeNewsItemsWithQuality } from "@shared/news-item-schema";

import { createCrawlerTaskQueue } from "../../crawler-platform/host/task-queue";

export type SourceAdapterKind = "legacy" | "plugin" | "configured";

export interface SourceDescriptor {
    id: SourceID;
    kind: SourceAdapterKind;
}

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
    now?: () => number;
}

export interface SourceCollectOptions {
    signal?: AbortSignal;
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
    now = Date.now,
    maxConcurrent = 8,
    maxQueued = 100,
    queueTimeoutMs = 8_000,
}: SourceEngineOptions) {
    const adapters = new Map<SourceID, SourceAdapter>();
    for (const adapter of initialAdapters) {
        registerAdapter(adapter);
    }
    const inflightRequests = new Map<SourceID, Promise<NewsItem[]>>();
    const queue = createCrawlerTaskQueue({ maxConcurrent, maxQueued, queueTimeoutMs });

    const collect = (id: SourceID, options: SourceCollectOptions = {}): Promise<NewsItem[]> => {
        const pending = inflightRequests.get(id);
        if (pending) return pending;

        const startTime = now();
        const controller = new AbortController();
        const abort = () => controller.abort();
        options.signal?.addEventListener("abort", abort, { once: true });
        const request = queue
            .run(async () => {
                const adapter = adapters.get(id) ?? resolveAdapter?.(id);
                if (!adapter) throw new Error(`Source ${id} is not registered.`);

                return adapter.collect({
                    sourceId: id,
                    signal: controller.signal,
                    now,
                });
            })
            .then((items) => {
                if (!Array.isArray(items)) throw new Error(`Source ${id} returned a non-array result.`);
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
                options.signal?.removeEventListener("abort", abort);
                inflightRequests.delete(id);
            });

        inflightRequests.set(id, request);
        return request;
    };

    return {
        collect,
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

    function registerAdapter(adapter: SourceAdapter) {
        const existing = adapters.get(adapter.descriptor.id);
        if (existing && existing !== adapter) {
            throw new Error(`Source ${adapter.descriptor.id} is already registered.`);
        }
        adapters.set(adapter.descriptor.id, adapter);
    }
}
