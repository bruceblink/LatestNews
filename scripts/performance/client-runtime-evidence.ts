import assert from "node:assert/strict";
import { rename, writeFile } from "node:fs/promises";

export const CLIENT_CYCLE_MS = 15_000;
export const CLIENT_TIMING_NAMES = [
    "feedVisible",
    "readAction",
    "archiveAndEventVisible",
    "historyVisible",
    "insightsVisible",
] as const;

export function timingDistribution(values: number[]) {
    assert(
        values.every((value) => Number.isFinite(value) && value >= 0),
        "Invalid timing sample"
    );
    const sorted = [...values].sort((a, b) => a - b);
    const at = (q: number) => sorted[Math.ceil(q * sorted.length) - 1] ?? null;
    return { count: sorted.length, p50Ms: at(0.5), p95Ms: at(0.95), p99Ms: at(0.99), maxMs: sorted.at(-1) ?? null };
}
export function summarizeClientCycles(cycles: number[][]) {
    assert(
        cycles.every((cycle) => cycle.length === CLIENT_TIMING_NAMES.length),
        "Incomplete operation timings"
    );
    return Object.fromEntries(
        CLIENT_TIMING_NAMES.map((name, i) => [name, timingDistribution(cycles.map((c) => c[i]))])
    );
}
export function clientSlotExpired(now: number, start: number, slot: number, seconds: number) {
    return now >= Math.min(start + (slot + 1) * CLIENT_CYCLE_MS, start + seconds * 1000);
}
export function expectedClientCycles(seconds: number) {
    assert(Number.isSafeInteger(seconds) && seconds > 0);
    return Math.ceil((seconds * 1000) / CLIENT_CYCLE_MS);
}
export function summarizeMetricTrend(values: number[]) {
    assert(
        values.length > 0 && values.every((value) => Number.isFinite(value) && value >= 0),
        "Invalid metric samples"
    );
    const n = Math.min(5, values.length);
    const median = (v: number[]) => timingDistribution(v).p50Ms!;
    return {
        count: values.length,
        first: values[0],
        last: values.at(-1),
        min: Math.min(...values),
        max: Math.max(...values),
        firstWindowMedian: median(values.slice(0, n)),
        lastWindowMedian: median(values.slice(-n)),
        windowSize: n,
    };
}
/** Atomic publication preserves the previous complete checkpoint on interruption.
 * A running checkpoint is evidence of progress, not a passing result. */
export async function writeClientEvidence(path: string, report: unknown) {
    const temp = path + ".partial";
    await writeFile(temp, JSON.stringify(report, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
    await rename(temp, path);
}
