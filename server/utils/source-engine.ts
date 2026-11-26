import type { NewsItem, SourceID } from "@shared/types";
import type { SourceDescriptor } from "@shared/source-adapter";
import type { NewsItemsNormalizationQuality } from "@shared/news-item-schema";

import { normalizeNewsItemsWithQuality } from "@shared/news-item-schema";

import { CrawlerPlatformError } from "../../crawler-platform/core/errors";
import { createCrawlerTaskQueue } from "../../crawler-platform/host/task-queue";
import {
    recordTrace,
    monotonicNow,
    createTraceId,
    getTraceOutcome,
    type CollectionTrace,
    type CollectionTraceOutcome,
} from "./collection-trace";

import type { SourceHealthPersistence } from "../database/source-health-events";

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
    onSuccess: (
        id: SourceID,
        durationMs: number,
        itemCount: number,
        persistence?: SourceHealthPersistence
    ) => void | Promise<void>;
    onQuality?: (id: SourceID, quality: NewsItemsNormalizationQuality, sampledAt: number) => void;
    onFailure: (
        id: SourceID,
        durationMs: number,
        error: unknown,
        persistence?: SourceHealthPersistence
    ) => void | Promise<void>;
    onAdapter?: (id: SourceID, descriptor: SourceDescriptor) => void;
    now?: () => number;
    trace?: CollectionTrace;
}

export interface SourceCollectOptions {
    signal?: AbortSignal;
    requestId?: string;
    healthPersistence?: SourceHealthPersistence;
}

interface SourceTraceState {
    trace: CollectionTrace;
    collectionId: string;
    requestId?: string;
    queuedAt: number;
    adapterStartedAt?: number;
    collectEndedAt?: number;
    normalizeStartedAt?: number;
    normalizeEndedAt?: number;
    recorded: boolean;
}

interface SourceCollection {
    controller: AbortController;
    result: Promise<NewsItem[]>;
    callers: number;
}

/** Explicit operator/benchmark override; absent configuration retains the default 8. */
export function parseSourceConcurrency(value: string | undefined): number {
    if (value === undefined || value === "") return 8;
    if (!/^[0-9]+$/.test(value) || Number(value) < 1 || Number(value) > 16) {
        throw new RangeError("LATESTNEWS_SOURCE_MAX_CONCURRENT must be an integer from 1 to 16.");
    }
    return Number(value);
}

/** Shared source execution boundary for legacy getters, trusted plugins and configured sources. */
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
    trace: initialTrace,
}: SourceEngineOptions) {
    const adapters = new Map<SourceID, SourceAdapter>();
    for (const adapter of initialAdapters) registerAdapter(adapter);
    const inflightRequests = new Map<SourceID, SourceCollection>();
    const queue = createCrawlerTaskQueue({ maxConcurrent, maxQueued, queueTimeoutMs });
    let closed = false;
    let trace = initialTrace;

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
        setTrace(nextTrace?: CollectionTrace) {
            trace = nextTrace;
        },
        listDescriptors(): SourceDescriptor[] {
            return [...adapters.values()].map(({ descriptor }) => descriptor);
        },
    };

    function collect(
        id: SourceID,
        { signal, requestId, healthPersistence }: SourceCollectOptions = {}
    ): Promise<NewsItem[]> {
        if (closed || signal?.aborted) return Promise.reject(cancelledCollection(id));
        const pending = inflightRequests.get(id);
        const collection =
            pending && !pending.controller.signal.aborted ? pending : startCollection(id, requestId, healthPersistence);
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

    function startCollection(
        id: SourceID,
        requestId?: string,
        healthPersistence?: SourceHealthPersistence
    ): SourceCollection {
        let healthWork: void | Promise<void>;
        const controller = new AbortController();
        const startTime = now();
        const traceState: SourceTraceState | undefined = trace
            ? {
                  trace,
                  collectionId: createTraceId("collection"),
                  ...(requestId ? { requestId } : {}),
                  queuedAt: monotonicNow(),
                  recorded: false,
              }
            : undefined;

        const result = queue
            .run(async (signal) => {
                if (traceState) traceState.adapterStartedAt = monotonicNow();
                const adapter = adapters.get(id) ?? resolveAdapter?.(id);
                if (!adapter) throw new Error("Source " + id + " is not registered.");
                onAdapter?.(id, adapter.descriptor);
                try {
                    const items = await adapter.collect({ sourceId: id, signal, now });
                    if (traceState) traceState.collectEndedAt = monotonicNow();
                    return items;
                } catch (error) {
                    if (traceState) traceState.collectEndedAt = monotonicNow();
                    throw error;
                }
            }, controller.signal)
            .then((items) => {
                if (controller.signal.aborted) throw cancelledCollection(id);
                if (!Array.isArray(items)) throw new Error("Source " + id + " returned a non-array result.");
                if (traceState) traceState.normalizeStartedAt = monotonicNow();
                const normalized = normalizeNewsItemsWithQuality(items, { sourceId: id });
                if (traceState) traceState.normalizeEndedAt = monotonicNow();
                const completedAt = now();
                healthWork = healthPersistence
                    ? onSuccess(id, completedAt - startTime, normalized.items.length, healthPersistence)
                    : onSuccess(id, completedAt - startTime, normalized.items.length);
                onQuality?.(id, normalized.quality, completedAt);
                return normalized.items;
            })
            .then((items) => {
                if (traceState) finishSourceTrace(traceState, "success", id);
                return items;
            })
            .catch((error: unknown) => {
                const outcome = controller.signal.aborted ? "cancelled" : getTraceOutcome(error);
                if (traceState) finishSourceTrace(traceState, outcome, id);
                if (controller.signal.aborted) throw cancelledCollection(id);
                if (!isCancellationError(error)) {
                    healthWork = healthPersistence
                        ? onFailure(id, now() - startTime, error, healthPersistence)
                        : onFailure(id, now() - startTime, error);
                }
                throw error;
            })
            .finally(() => {
                if (inflightRequests.get(id) === collection) inflightRequests.delete(id);
            });

        const collection = { controller, result, callers: 0 };
        inflightRequests.set(id, collection);
        // Register lifetime ownership before returning to the first caller.
        // A joiner must not append the same sample or replace its D1 binding.
        healthPersistence?.retain(
            result.then(
                () => healthWork,
                () => healthWork
            )
        );
        return collection;
    }

    function registerAdapter(adapter: SourceAdapter) {
        const existing = adapters.get(adapter.descriptor.id);
        if (existing && existing !== adapter) {
            throw new Error("Source " + adapter.descriptor.id + " is already registered.");
        }
        adapters.set(adapter.descriptor.id, adapter);
    }
}

function finishSourceTrace(state: SourceTraceState, outcome: CollectionTraceOutcome, sourceId: SourceID) {
    if (state.recorded) return;
    state.recorded = true;
    const finishedAt = monotonicNow();
    const queueEndedAt = state.adapterStartedAt ?? finishedAt;
    recordTrace(state.trace, {
        phase: "source.queue",
        durationMs: queueEndedAt - state.queuedAt,
        outcome,
        sourceId,
        requestId: state.requestId,
        collectionId: state.collectionId,
    });
    if (state.adapterStartedAt !== undefined) {
        recordTrace(state.trace, {
            phase: "source.collect",
            durationMs: (state.collectEndedAt ?? finishedAt) - state.adapterStartedAt,
            outcome,
            sourceId,
            requestId: state.requestId,
            collectionId: state.collectionId,
        });
    }
    if (state.normalizeStartedAt !== undefined) {
        recordTrace(state.trace, {
            phase: "source.normalize",
            durationMs: (state.normalizeEndedAt ?? finishedAt) - state.normalizeStartedAt,
            outcome,
            sourceId,
            requestId: state.requestId,
            collectionId: state.collectionId,
        });
    }
}

function cancelledCollection(id: SourceID) {
    return new CrawlerPlatformError("CANCELLED", "Collection for " + id + " was cancelled.");
}

export function isCancellationError(error: unknown) {
    return typeof error === "object" && error !== null && "code" in error && error.code === "CANCELLED";
}
