import { it, expect, describe, afterEach } from "vitest";

import {
    fixtureBehavior,
    summarizeLatencies,
    startLoopbackFixtures,
} from "../scripts/performance/http-collection-fixture";
import {
    runHttpCollectionScenario,
    parseHttpCollectionBenchmarkOptions,
} from "../scripts/performance/http-collection-baseline";

import type { LoopbackFixture } from "../scripts/performance/http-collection-fixture";

const fixturesToClose: LoopbackFixture[][] = [];

afterEach(async () => {
    while (fixturesToClose.length) await Promise.all(fixturesToClose.pop()!.map((fixture) => fixture.close()));
});

describe("controlled HTTP collection benchmark", () => {
    it("calculates stable nearest-rank quantiles without changing input", () => {
        const values = [5, 1, 3, 2, 4];
        expect(summarizeLatencies(values)).toEqual({ count: 5, p50: 3, p95: 5, p99: 5 });
        expect(values).toEqual([5, 1, 3, 2, 4]);
        expect(summarizeLatencies([])).toEqual({ count: 0, p50: null, p95: null, p99: null });
    });

    it("uses a fixed seed to derive deterministic latency, failures and cancellation", () => {
        expect(fixtureBehavior("jitter-spread", 7, 20261123)).toEqual(fixtureBehavior("jitter-spread", 7, 20261123));
        expect(fixtureBehavior("single-origin", 7, 20261123).delayMs).toBe(16);
        expect(Array.from({ length: 100 }, (_, i) => fixtureBehavior("http-errors", i, 20261123).status)).toContain(
            429
        );
        expect(Array.from({ length: 100 }, (_, i) => fixtureBehavior("http-errors", i, 20261123).status)).toContain(
            503
        );
        expect(
            Array.from({ length: 28 }, (_, i) => fixtureBehavior("client-cancel", i, 20261123).cancelByClient).filter(
                Boolean
            )
        ).toHaveLength(4);
    });

    it("requires at least 1000 samples unless explicitly in smoke mode", () => {
        expect(() => parseHttpCollectionBenchmarkOptions(["--samples", "24"])).toThrow(/1000/);
        expect(() => parseHttpCollectionBenchmarkOptions(["--clients", "101"])).toThrow(/between/);
        expect(() => parseHttpCollectionBenchmarkOptions(["--scenarios", "unknown"])).toThrow(/Invalid/);
        const options = parseHttpCollectionBenchmarkOptions([
            "--smoke",
            "--samples",
            "24",
            "--clients",
            "8",
            "--source-concurrency",
            "4,6,8",
            "--scenarios",
            "fixed-spread,jitter-spread",
        ]);
        expect(options.samples).toBe(24);
        expect(options.sourceConcurrency).toEqual([4, 6, 8]);
        expect(options.scenarios).toEqual(["fixed-spread", "jitter-spread"]);
    });

    it("isolates fixed and single-origin queues with real loopback fetch calls", async () => {
        const fixtures = await startLoopbackFixtures(4);
        fixturesToClose.push(fixtures);
        const options = parseHttpCollectionBenchmarkOptions(["--smoke", "--samples", "28", "--clients", "12"]);
        const spread = await runHttpCollectionScenario("fixed-spread", 4, options, fixtures);
        expect(spread.passed).toBe(true);
        expect(spread.successfulRequests).toBe(28);
        expect(spread.statusMismatchCount).toBe(0);
        expect(spread.maxSourceActive).toBeLessThanOrEqual(4);
        expect(spread.phasesMs["source.queue"]?.count).toBe(28);
        expect(spread.phasesMs["http.request"]?.count).toBe(28);

        const hot = await runHttpCollectionScenario("single-origin", 8, options, fixtures);
        expect(hot.passed).toBe(true);
        expect(hot.fixtureMaxConcurrentByOrigin[0]).toBeLessThanOrEqual(2);
        expect(hot.fixtureMaxConcurrentByOrigin.slice(1)).toEqual([0, 0, 0]);
        expect(hot.phasesMs["http.queue"]?.count).toBe(28);
        expect(hot.cacheHitRate).toBeNull();
        expect(hot.backgroundCacheTasks).toBeNull();
        expect(hot.schedulerPendingAfterScenario).toBe(0);
    }, 15000);

    it("validates injected HTTP errors and independent client cancellations", async () => {
        const fixtures = await startLoopbackFixtures(4);
        fixturesToClose.push(fixtures);
        const options = parseHttpCollectionBenchmarkOptions(["--smoke", "--samples", "92", "--clients", "12"]);
        const faults = await runHttpCollectionScenario("http-errors", 6, options, fixtures);
        expect(faults.passed).toBe(true);
        expect(faults.statusMismatchCount).toBe(0);
        expect(faults.errorRequests).toBeGreaterThan(0);
        expect(faults.fixtureHttpStatuses["429"]).toBeGreaterThan(0);
        expect(faults.fixtureHttpStatuses["503"]).toBeGreaterThan(0);

        const cancelled = await runHttpCollectionScenario("client-cancel", 6, options, fixtures);
        expect(cancelled.passed).toBe(true);
        expect(cancelled.cancelledRequests).toBeGreaterThan(0);
        expect(cancelled.statusMismatchCount).toBe(0);
        expect(cancelled.schedulerPendingAfterScenario).toBe(0);
    }, 20000);
});
