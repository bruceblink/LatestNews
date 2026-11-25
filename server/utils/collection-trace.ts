import { performance } from "node:perf_hooks";

export type CollectionTracePhase =
    | "source.queue"
    | "source.collect"
    | "source.normalize"
    | "http.queue"
    | "http.request"
    | "cache.read"
    | "cache.commit"
    | "index.queue"
    | "index.replay"
    | "index.repair";

export type CollectionTraceOutcome = "success" | "error" | "timeout" | "cancelled";

export interface CollectionTraceSpan {
    phase: CollectionTracePhase;
    durationMs: number;
    outcome: CollectionTraceOutcome;
    sourceId?: string;
    requestId?: string;
    collectionId?: string;
    fetchId?: string;
    key?: string;
}

export interface CollectionTrace {
    record(span: CollectionTraceSpan): void;
}

let nextTraceId = 0;

export function createTraceId(prefix: string) {
    nextTraceId += 1;
    return prefix + "-" + nextTraceId.toString(36);
}

export function monotonicNow() {
    return performance.now();
}

export function getTraceOutcome(error: unknown): CollectionTraceOutcome {
    if (typeof error === "object" && error !== null && "code" in error) {
        const code = error.code;
        if (code === "CANCELLED") return "cancelled";
        if (code === "TIMEOUT") return "timeout";
    }
    return "error";
}

export function recordTrace(trace: CollectionTrace | undefined, span: CollectionTraceSpan) {
    if (!trace) return;
    try {
        trace.record({ ...span, durationMs: Math.max(0, span.durationMs) });
    } catch {
        // Observability must never change the collection result.
    }
}

/** The isolated Node benchmark preloader may install an in-process sink.
 * No public HTTP control or filesystem output is enabled by application code.
 */
export function getBenchmarkTrace(): CollectionTrace | undefined {
    const sink = (globalThis as Record<symbol, unknown>)[Symbol.for("latestnews.performance.trace")];
    return sink && typeof (sink as CollectionTrace).record === "function" ? (sink as CollectionTrace) : undefined;
}

export function measureBenchmarkPhase<T>(phase: CollectionTracePhase, operation: () => Promise<T>): Promise<T> {
    const trace = getBenchmarkTrace();
    if (!trace) return operation();
    const start = monotonicNow();
    return (async () => {
        try {
            const result = await operation();
            recordTrace(trace, { phase, durationMs: monotonicNow() - start, outcome: "success" });
            return result;
        } catch (error) {
            recordTrace(trace, { phase, durationMs: monotonicNow() - start, outcome: getTraceOutcome(error) });
            throw error;
        }
    })();
}
