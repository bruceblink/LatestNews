import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { join, resolve } from "node:path";
import { readFile } from "node:fs/promises";

import { distribution } from "./article-online-metrics";
import { sourceFor, ITEMS_PER_SNAPSHOT } from "./article-online-worker";
import { validateSlotResult, evaluateOnlineAcceptance } from "./article-online-gate";

import type { PressureSample } from "./article-online-diagnostics";
import type { SlotResult, AcceptanceInput } from "./article-online-gate";

const files = ["write.json", "read.json", "host.json", "maintenance.json", "result.json"] as const;
const countKeys = [
    "passes",
    "busy",
    "failed",
    "unavailable",
    "interrupted",
    "completed",
    "advanced",
    "maxPending",
    "maxOldestAgeMs",
    "maxPendingFts",
    "maxAttempts",
] as const;
type EvidenceFile = (typeof files)[number];
type Distribution = ReturnType<typeof distribution>;
type Worker = SlotResult & { metrics: unknown; runtime: unknown; slow: unknown };
type WorkerSummary = AcceptanceInput["writes"] & {
    role: SlotResult["role"];
    rate: number;
    retries: number;
    latency: Distribution;
    recoveryOverlap: Distribution;
    schedulingLag: Distribution;
    modes: Record<string, number>;
    sql: unknown;
    runtime: unknown;
    slow: unknown;
};
type Window = { startedAt: number; endedAt: number };
type Counts = AcceptanceInput["maintenance"] & {
    passes: number;
    busy: number;
    completed: number;
    advanced: number;
    maxPending: number;
    maxOldestAgeMs: number;
    maxPendingFts: number;
    maxAttempts: number;
};
type Maintenance = Counts & { passLatency: Distribution; queueWindows: unknown; sql: unknown; slow: unknown };
type PreDrain = {
    settled: boolean;
    recovery: Window[];
    maintenance: Counts;
    queueWindows: unknown;
    passLatency: Distribution;
    sql: unknown;
    slow: unknown;
    fixture: unknown;
    pressureBefore: unknown;
    pressureAfterFixture: unknown;
};
interface RunResult {
    result: string;
    correctnessPassed: boolean;
    operationalPassed: boolean;
    loadCompleted: boolean;
    recoveryCompleted: boolean;
    drained: boolean;
    plannedRecoveries: number;
    mode: "repair" | "control";
    size: number;
    page: number;
    seconds: number;
    writeRate: number;
    readRate: number;
    rebuildEvery: number;
    journal: "delete" | "wal";
    offeredLoadSeconds: number;
    elapsedThroughDrainMs: number;
    environment: {
        sqlite: {
            journal: { journal_mode: string }[];
            synchronous: { synchronous: number }[];
            busyTimeout: { timeout: number }[];
        };
    };
    recovery: Array<{ startedAfterMs: number; durationMs: number }>;
    recoveryMs: Distribution;
    writes: WorkerSummary;
    reads: WorkerSummary;
    maintenance: Maintenance;
    diagnostics: {
        pressure: PressureSample[];
        fixture: unknown;
        pressureBefore: unknown;
        pressureAfterFixture: unknown;
    };
    correctness: null | {
        articles: number;
        acknowledgedSnapshots: number;
        uniqueLoadArticles: number;
        health: {
            status: string;
            fts: string;
            ftsAudit?: { status: string };
            pendingIngest: number;
            pendingFts: number;
            untrackedCache: number;
        };
    };
    productionD1: boolean;
}
function finiteInteger(value: number, min: number, max: number) {
    assert(Number.isSafeInteger(value) && value >= min && value <= max, "Invalid workload parameter");
}
function verifyWorker(
    worker: Worker,
    summary: WorkerSummary,
    role: SlotResult["role"],
    rate: number,
    seconds: number,
    windows: Window[]
) {
    validateSlotResult(worker, role, rate, seconds);
    const ok = worker.samples.filter((s) => s.ok);
    const modes: Record<string, number> = {};
    for (const sample of worker.samples) {
        assert(sample.endedAt >= sample.startedAt, "Worker time runs backwards");
        if (sample.ok && role === "read")
            assert(sample.mode === "fts" || sample.mode === "like", "Unknown search mode");
        if (sample.ok && sample.mode) modes[sample.mode] = (modes[sample.mode] ?? 0) + 1;
    }
    assert.deepEqual(
        summary,
        {
            role,
            rate,
            slots: worker.slots,
            skipped: worker.skipped,
            completed: ok.length,
            errors: worker.samples.length - ok.length,
            retries: worker.samples.reduce((n, s) => n + s.retries, 0),
            latency: distribution(ok.map((s) => s.durationMs)),
            recoveryOverlap: distribution(
                ok
                    .filter((s) => windows.some((w) => s.startedAt <= w.endedAt && s.endedAt >= w.startedAt))
                    .map((s) => s.durationMs)
            ),
            schedulingLag: distribution(worker.samples.map((s) => s.schedulingLagMs)),
            modes,
            sql: worker.metrics,
            runtime: worker.runtime,
            slow: worker.slow,
        },
        "Worker summary does not match raw evidence"
    );
}

/** Offline consistency check, not a second execution of the database audit.
 * It cannot establish provenance or truth of fabricated evidence. */
export async function verifyArticleOnlineEvidence(directory: string) {
    const raw = await Promise.all(files.map((name) => readFile(join(directory, name))));
    const parsed = raw.map((bytes) => JSON.parse(bytes.toString("utf8"))) as [
        Worker,
        Worker,
        PressureSample[],
        PreDrain,
        RunResult,
    ];
    const [write, read, host, preDrain, result] = parsed;
    const hashes = Object.fromEntries(
        files.map((name, i) => [
            name,
            { bytes: raw[i].length, sha256: createHash("sha256").update(raw[i]).digest("hex") },
        ])
    ) as Record<EvidenceFile, { bytes: number; sha256: string }>;
    finiteInteger(result.seconds, 2, 1800);
    finiteInteger(result.size, 1000, 100000);
    finiteInteger(result.writeRate, 1, 20);
    finiteInteger(result.readRate, 1, 50);
    finiteInteger(result.rebuildEvery, 0, 1800);
    assert([50, 100, 200].includes(result.page));
    assert(result.mode === "repair" || result.mode === "control");
    assert(result.journal === "delete" || result.journal === "wal");
    assert.equal(result.productionD1, false);
    assert.deepEqual(result.environment.sqlite.journal, [{ journal_mode: result.journal }]);
    assert.deepEqual(result.environment.sqlite.synchronous, [{ synchronous: 2 }]);
    assert.deepEqual(result.environment.sqlite.busyTimeout, [{ timeout: 5000 }]);
    assert.equal(result.offeredLoadSeconds, result.seconds);
    assert(Number.isFinite(result.elapsedThroughDrainMs) && result.elapsedThroughDrainMs >= result.seconds * 1000);
    assert.equal(preDrain.settled, true, "Missing settled maintenance checkpoint");
    assert.deepEqual(host, result.diagnostics.pressure, "Host observer result differs");
    assert(Array.isArray(host) && host.length > 0, "Missing host observer samples");
    for (let i = 0; i < host.length; i++) {
        const sample = host[i];
        assert(
            [sample.startedAt, sample.wallMs, sample.cpuMs, sample.lateMs, ...Object.values(sample.pressure)].every(
                (value) => typeof value === "number" && Number.isFinite(value) && value >= 0
            ),
            "Invalid observer sample"
        );
        assert(i === 0 || sample.startedAt >= host[i - 1].startedAt, "Observer time runs backwards");
    }
    assert.deepEqual(preDrain.fixture, result.diagnostics.fixture);
    assert.deepEqual(preDrain.pressureBefore, result.diagnostics.pressureBefore);
    assert.deepEqual(preDrain.pressureAfterFixture, result.diagnostics.pressureAfterFixture);
    assert.equal(result.recovery.length, preDrain.recovery.length);
    for (let i = 0; i < preDrain.recovery.length; i++) {
        const window = preDrain.recovery[i];
        const entry = result.recovery[i];
        assert(window.endedAt >= window.startedAt);
        assert(i === 0 || window.startedAt >= preDrain.recovery[i - 1].endedAt, "Overlapping rebuilds");
        assert.equal(entry.durationMs, window.endedAt - window.startedAt);
        assert(entry.startedAfterMs >= 0 && entry.startedAfterMs < result.seconds * 1000);
        if (i > 0)
            assert.equal(
                entry.startedAfterMs - result.recovery[0].startedAfterMs,
                window.startedAt - preDrain.recovery[0].startedAt
            );
    }
    assert.deepEqual(result.recoveryMs, distribution(preDrain.recovery.map((w) => w.endedAt - w.startedAt)));
    verifyWorker(write, result.writes, "write", result.writeRate, result.seconds, preDrain.recovery);
    verifyWorker(read, result.reads, "read", result.readRate, result.seconds, preDrain.recovery);
    for (const key of countKeys) {
        finiteInteger(preDrain.maintenance[key], 0, Number.MAX_SAFE_INTEGER);
        finiteInteger(result.maintenance[key], preDrain.maintenance[key], Number.MAX_SAFE_INTEGER);
    }
    assert.deepEqual(preDrain.queueWindows, result.maintenance.queueWindows);
    assert.equal(result.maintenance.passLatency.samples, result.maintenance.passes);
    const planned =
        result.mode === "control" ? 0 : result.rebuildEvery ? Math.ceil(result.seconds / result.rebuildEvery) : 1;
    assert.equal(result.plannedRecoveries, planned);
    assert(typeof result.drained === "boolean");
    assert(
        result.correctness === null || (typeof result.correctness === "object" && result.correctness !== null),
        "Missing final correctness evidence"
    );
    assert.equal(result.correctnessPassed, result.correctness !== null);
    if (result.correctness) {
        const c = result.correctness;
        assert.equal(c.acknowledgedSnapshots, result.writes.completed);
        const successful = write.samples.filter((sample) => sample.ok);
        const touchedSources = new Set(successful.map((sample) => sourceFor(sample.sequence)));
        assert.equal(c.uniqueLoadArticles, successful.length + (ITEMS_PER_SNAPSHOT - 1) * touchedSources.size);
        assert.equal(c.articles, result.size + c.uniqueLoadArticles);
        assert.equal(c.health.status, "ok");
        assert.equal(c.health.fts, "ok");
        assert.equal(c.health.ftsAudit?.status, "verified");
        assert.equal(c.health.pendingIngest, 0);
        assert.equal(c.health.pendingFts, 0);
        assert.equal(c.health.untrackedCache, 0);
    }
    const acceptance = evaluateOnlineAcceptance({
        writes: result.writes,
        reads: result.reads,
        maintenance: result.maintenance,
        correctnessPassed: result.correctness !== null,
        drained: result.drained,
        plannedRecoveries: planned,
        completedRecoveries: result.recovery.length,
    });
    for (const key of Object.keys(acceptance) as Array<keyof typeof acceptance>)
        assert.equal(result[key], acceptance[key], "Inconsistent acceptance flag: " + key);
    return {
        evidenceVerified: true,
        ...acceptance,
        plannedRecoveries: planned,
        completedRecoveries: result.recovery.length,
        writes: result.writes.completed,
        reads: result.reads.completed,
        fileHashes: hashes,
    };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    const directories = process.argv.slice(2);
    assert(directories.length > 0, "Provide one or more completed evidence directories.");
    for (const directory of directories) {
        const verified = await verifyArticleOnlineEvidence(directory);
        console.log(JSON.stringify(verified));
        if (verified.result !== "passed") process.exitCode = 2;
    }
}
