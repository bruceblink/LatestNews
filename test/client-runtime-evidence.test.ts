import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, expect, describe } from "vitest";
import { rm, mkdtemp, readFile, writeFile } from "node:fs/promises";

import {
    clientSlotExpired,
    timingDistribution,
    writeClientEvidence,
    expectedClientCycles,
    summarizeMetricTrend,
    summarizeClientCycles,
} from "../scripts/performance/client-runtime-evidence";

describe("client runtime evidence", () => {
    it("accounts for fixed slots without counting expired timer callbacks", () => {
        expect(expectedClientCycles(1800)).toBe(120);
        expect(expectedClientCycles(20)).toBe(2);
        expect(clientSlotExpired(15999, 1000, 0, 20)).toBe(false);
        expect(clientSlotExpired(16000, 1000, 0, 20)).toBe(true);
        expect(clientSlotExpired(21000, 1000, 1, 20)).toBe(true);
        expect(() => expectedClientCycles(0)).toThrow();
    });
    it("summarizes measured content latency without accepting incomplete cycles", () => {
        expect(timingDistribution([4, 1, 2, 3, 5])).toEqual({ count: 5, p50Ms: 3, p95Ms: 5, p99Ms: 5, maxMs: 5 });
        expect(timingDistribution([])).toEqual({ count: 0, p50Ms: null, p95Ms: null, p99Ms: null, maxMs: null });
        expect(
            summarizeClientCycles([
                [1, 2, 3, 4, 5],
                [6, 7, 8, 9, 10],
            ]).archiveAndEventVisible.p95Ms
        ).toBe(8);
        expect(() => summarizeClientCycles([[1, 2]])).toThrow();
        expect(() => timingDistribution([Infinity])).toThrow();
    });
    it("reports early and late sampling windows, not an automatic memory-leak verdict", () => {
        expect(summarizeMetricTrend([100, 200, 300, 400, 500, 600, 700, 800, 900, 1000])).toEqual({
            count: 10,
            first: 100,
            last: 1000,
            min: 100,
            max: 1000,
            firstWindowMedian: 300,
            lastWindowMedian: 800,
            windowSize: 5,
        });
        expect(() => summarizeMetricTrend([])).toThrow();
    });
    it("keeps the last complete checkpoint if the next publication cannot finish", async () => {
        const dir = await mkdtemp(join(tmpdir(), "ln-client-evidence-test-"));
        try {
            const path = join(dir, "report.json");
            await writeClientEvidence(path, { result: "running", cycles: 4 });
            await writeFile(path + ".partial", '{"result":');
            await expect(writeClientEvidence(path, { result: "passed" })).rejects.toThrow();
            expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ result: "running", cycles: 4 });
            await rm(path + ".partial");
            await writeClientEvidence(path, { result: "passed", cycles: 120 });
            expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ result: "passed", cycles: 120 });
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });
});
