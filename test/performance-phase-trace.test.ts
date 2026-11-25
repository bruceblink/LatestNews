import { it, vi, expect, describe, afterEach } from "vitest";

import { getBenchmarkTrace, measureBenchmarkPhase } from "../server/utils/collection-trace";

import type { CollectionTraceSpan } from "../server/utils/collection-trace";

const key = Symbol.for("latestnews.performance.trace");
const globals = globalThis as Record<symbol, unknown>;
afterEach(() => {
    delete globals[key];
});

describe("isolated benchmark phase trace", () => {
    it("leaves the original promise unchanged without a sink", () => {
        const result = Promise.resolve(123);
        expect(getBenchmarkTrace()).toBeUndefined();
        expect(measureBenchmarkPhase("cache.read", () => result)).toBe(result);
    });
    it("reports phase, duration and outcome without payload or error details", async () => {
        const spans: CollectionTraceSpan[] = [];
        globals[key] = {
            record(span: CollectionTraceSpan) {
                spans.push(span);
            },
        };
        await expect(measureBenchmarkPhase("cache.commit", async () => 123)).resolves.toBe(123);
        const failure = Object.assign(new Error("fixture-secret"), { code: "TIMEOUT" });
        await expect(
            measureBenchmarkPhase("index.replay", async () => {
                throw failure;
            })
        ).rejects.toBe(failure);
        expect(spans).toEqual([
            { phase: "cache.commit", outcome: "success", durationMs: expect.any(Number) },
            { phase: "index.replay", outcome: "timeout", durationMs: expect.any(Number) },
        ]);
        expect(spans.every((span) => span.durationMs >= 0)).toBe(true);
    });
    it("does not change results when an instrumentation sink throws", async () => {
        const record = vi.fn(() => {
            throw new Error("sink");
        });
        globals[key] = { record };
        await expect(measureBenchmarkPhase("cache.read", async () => "fixture")).resolves.toBe("fixture");
        expect(record).toHaveBeenCalledOnce();
    });
});
