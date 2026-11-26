import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, expect, describe } from "vitest";
import { rm, mkdtemp, writeFile } from "node:fs/promises";

import { distribution } from "../scripts/performance/article-online-metrics";
import { verifyArticleOnlineEvidence } from "../scripts/performance/verify-article-online-evidence";

function fixture(skip = false) {
    const createWorker = (role: "write" | "read", skipped = 0) => ({
        role,
        rate: 1,
        slots: 2,
        skipped,
        samples: Array.from({ length: 2 - skipped }, (_, sequence) => ({
            sequence,
            startedAt: 1000 + sequence * 1000,
            endedAt: 1010 + sequence * 1000,
            durationMs: 10,
            schedulingLagMs: 0,
            retries: 0,
            ok: true,
            ...(role === "read" ? { mode: "fts" } : {}),
        })),
        metrics: {},
        runtime: {},
        slow: {},
    });
    const write = createWorker("write", skip ? 1 : 0),
        read = createWorker("read");
    const summarize = (w: ReturnType<typeof createWorker>) => ({
        role: w.role,
        rate: w.rate,
        slots: w.slots,
        skipped: w.skipped,
        completed: w.samples.length,
        errors: 0,
        retries: 0,
        latency: distribution(w.samples.map((s) => s.durationMs)),
        recoveryOverlap: distribution([]),
        schedulingLag: distribution(w.samples.map((s) => s.schedulingLagMs)),
        modes: w.role === "read" ? { fts: w.samples.length } : {},
        sql: w.metrics,
        runtime: w.runtime,
        slow: w.slow,
    });
    const host = [{ startedAt: 1000, wallMs: 250, cpuMs: 1, lateMs: 0, pressure: {} }];
    const counts = {
        passes: 1,
        busy: 0,
        failed: 0,
        unavailable: 0,
        interrupted: 0,
        completed: 1,
        advanced: 0,
        maxPending: 1,
        maxOldestAgeMs: 0,
        maxPendingFts: 1,
        maxAttempts: 0,
    };
    const maintenance = {
        settled: true,
        recovery: [],
        maintenance: counts,
        queueWindows: [],
        passLatency: distribution([10]),
        sql: {},
        slow: {},
        fixture: {},
        pressureBefore: {},
        pressureAfterFixture: {},
    };
    const result = {
        result: skip ? "incomplete-load" : "passed",
        correctnessPassed: true,
        operationalPassed: true,
        loadCompleted: !skip,
        recoveryCompleted: true,
        drained: true,
        plannedRecoveries: 0,
        mode: "control",
        size: 1000,
        page: 100,
        seconds: 2,
        writeRate: 1,
        readRate: 1,
        rebuildEvery: 0,
        journal: "delete",
        offeredLoadSeconds: 2,
        elapsedThroughDrainMs: 2100,
        recovery: [],
        recoveryMs: distribution([]),
        environment: {
            sqlite: {
                journal: [{ journal_mode: "delete" }],
                synchronous: [{ synchronous: 2 }],
                busyTimeout: [{ timeout: 5000 }],
            },
        },
        writes: summarize(write),
        reads: summarize(read),
        maintenance: { ...counts, queueWindows: [], passLatency: distribution([10]) },
        diagnostics: { pressure: host, fixture: {}, pressureBefore: {}, pressureAfterFixture: {} },
        correctness: {
            articles: 1000 + write.samples.length * 30,
            acknowledgedSnapshots: write.samples.length,
            uniqueLoadArticles: write.samples.length * 30,
            health: {
                status: "ok",
                fts: "ok",
                ftsAudit: { status: "verified" },
                pendingIngest: 0,
                pendingFts: 0,
                untrackedCache: 0,
            },
        },
        productionD1: false,
    };
    return { write, read, host, maintenance, result };
}
async function withEvidence(data: ReturnType<typeof fixture>, run: (directory: string) => Promise<void>) {
    const directory = await mkdtemp(join(tmpdir(), "ln-verify-online-"));
    try {
        await Promise.all(
            Object.entries(data).map(([name, value]) =>
                writeFile(join(directory, name + ".json"), JSON.stringify(value))
            )
        );
        await run(directory);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}

describe("offline online-load evidence verification", () => {
    it("recomputes summaries and validates a complete result bundle", async () => {
        await withEvidence(fixture(), async (directory) => {
            const result = await verifyArticleOnlineEvidence(directory);
            expect(result).toMatchObject({ evidenceVerified: true, result: "passed", writes: 2, reads: 2 });
            expect(Object.keys(result.fileHashes)).toHaveLength(5);
            expect(result.fileHashes["write.json"].sha256).toMatch(/^[a-f0-9]{64}$/);
        });
    });
    it("retains a correctly reported skipped load as incomplete, not passed", async () => {
        await withEvidence(fixture(true), async (directory) => {
            expect(await verifyArticleOnlineEvidence(directory)).toMatchObject({
                result: "incomplete-load",
                evidenceVerified: true,
                loadCompleted: false,
            });
        });
    });
    it("rejects changed percentiles, acceptance flags, and final maintenance counters", async () => {
        for (const change of [
            (d: ReturnType<typeof fixture>) => {
                d.result.writes.latency.p95Ms = 1;
            },
            (d: ReturnType<typeof fixture>) => {
                d.result.operationalPassed = false;
            },
            (d: ReturnType<typeof fixture>) => {
                d.result.maintenance.passes = 0;
            },
            (d: ReturnType<typeof fixture>) => {
                d.result.correctness.health.pendingFts = 1;
            },
            (d: ReturnType<typeof fixture>) => {
                Reflect.deleteProperty(d.result, "correctness");
            },
            (d: ReturnType<typeof fixture>) => {
                d.result.environment.sqlite.synchronous[0].synchronous = 1;
            },
        ]) {
            const data = fixture();
            change(data);
            await withEvidence(data, async (directory) => {
                await expect(verifyArticleOnlineEvidence(directory)).rejects.toThrow();
            });
        }
    });
    it("rejects missing evidence and a mismatched host observation", async () => {
        await withEvidence(fixture(), async (directory) => {
            await rm(join(directory, "read.json"));
            await expect(verifyArticleOnlineEvidence(directory)).rejects.toThrow();
        });
        const data = fixture();
        data.result.diagnostics.pressure = [];
        await withEvidence(data, async (directory) => {
            await expect(verifyArticleOnlineEvidence(directory)).rejects.toThrow();
        });
    });
});
