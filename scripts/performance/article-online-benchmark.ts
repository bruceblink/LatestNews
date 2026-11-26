import type { ChildProcess } from "node:child_process";

import os from "node:os";
import { createDatabase } from "db0";
import { parseArgs } from "node:util";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { fork } from "node:child_process";
import { performance } from "node:perf_hooks";
import { rm, mkdir, mkdtemp } from "node:fs/promises";
import { join, resolve as resolvePath } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import sqliteConnector from "db0/connectors/better-sqlite3";

import { logger } from "../../server/utils/logger";
import { Cache } from "../../server/database/cache-store";
import { runOnlineWorker } from "./article-online-worker";
import { readOnlineResult, publishOnlineResult } from "./article-online-result";
import { validateSlotResult, evaluateOnlineAcceptance } from "./article-online-gate";
import { verifyOnlineFixture, initializeOnlineFixture } from "./article-online-fixture";
import { distribution, runtimeMetrics, instrumentSqlite } from "./article-online-metrics";
import { slowSpans, captureSpan, runHostProbe, hostPressure } from "./article-online-diagnostics";
import { readFtsAudit, beginFtsRepair, ftsRecoveryStatus } from "../../server/database/article-recovery";

import type { PressureSample } from "./article-online-diagnostics";
import type { OnlineStart, OnlineSample } from "./article-online-worker";
import type { SqliteBuildPage } from "../../server/database/article-recovery";
import type {
    NativeSqlite,
    runtimeMetrics as runtimeType,
    instrumentSqlite as instrumentType,
} from "./article-online-metrics";

interface WorkerResult {
    role: "read" | "write";
    rate: number;
    slots: number;
    skipped: number;
    samples: OnlineSample[];
    metrics: ReturnType<ReturnType<typeof instrumentType>>;
    runtime: ReturnType<ReturnType<typeof runtimeType>["finish"]>;
    slow: ReturnType<ReturnType<typeof slowSpans>["finish"]>;
}
interface RecoveryWindow {
    startedAt: number;
    endedAt: number;
}
interface WorkerHandle<T = WorkerResult> {
    child: ChildProcess;
    ready: Promise<void>;
    done: Promise<T>;
    exited: Promise<void>;
}
function startProcess<T>(args: string[], resultPath: string): WorkerHandle<T> {
    const child = fork(fileURLToPath(import.meta.url), [...args, resultPath], {
        execArgv: ["--import", "tsx"],
        env: { ...process.env, TSX_TSCONFIG_PATH: "tsconfig.node.json" },
        stdio: ["ignore", "ignore", "inherit", "ipc"],
    });
    let readyResolve!: () => void, readyReject!: (e: Error) => void;
    const ready = new Promise<void>((resolve, reject) => {
        readyResolve = resolve;
        readyReject = reject;
    });
    void ready.catch(() => {});
    child.on("message", (message: unknown) => {
        if ((message as { kind?: string })?.kind === "ready") readyResolve();
    });
    child.once("error", readyReject);
    const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
        child.once("close", (code, signal) => {
            readyReject(new Error(args[0] + " exited before readiness: " + code + "/" + signal));
            resolve({ code, signal });
        })
    );
    const done = closed.then(async ({ code, signal }) => {
        if (code !== 0 || signal !== null) throw new Error(args[0] + " failed: " + code + "/" + signal);
        return readOnlineResult<T>(resultPath);
    });
    void done.catch(() => {});
    return { child, ready, done, exited: closed.then(() => {}) };
}
function startWorker(
    path: string,
    role: "write" | "read",
    rate: number,
    size: number,
    page: SqliteBuildPage,
    evidenceDir: string
) {
    return startProcess<WorkerResult>(
        ["worker", path, role, String(rate), String(size), String(page)],
        join(evidenceDir, role + ".json")
    );
}

function summarizeWorker(worker: WorkerResult, windows: RecoveryWindow[]) {
    const ok = worker.samples.filter((s) => s.ok);
    const overlapping = ok.filter((s) => windows.some((w) => s.startedAt <= w.endedAt && s.endedAt >= w.startedAt));
    const modes: Record<string, number> = {};
    for (const s of ok) if (s.mode) modes[s.mode] = (modes[s.mode] ?? 0) + 1;
    return {
        role: worker.role,
        rate: worker.rate,
        slots: worker.slots,
        skipped: worker.skipped,
        completed: ok.length,
        errors: worker.samples.length - ok.length,
        retries: worker.samples.reduce((n, s) => n + s.retries, 0),
        latency: distribution(ok.map((s) => s.durationMs)),
        recoveryOverlap: distribution(overlapping.map((s) => s.durationMs)),
        schedulingLag: distribution(worker.samples.map((s) => s.schedulingLagMs)),
        modes,
        sql: worker.metrics,
        runtime: worker.runtime,
        slow: worker.slow,
    };
}
function integer(value: string | undefined, min: number, max: number) {
    const n = Number(value);
    assert(Number.isSafeInteger(n) && n >= min && n <= max);
    return n;
}

async function main() {
    const { values } = parseArgs({
        options: {
            size: { type: "string", default: "100000" },
            page: { type: "string", default: "100" },
            mode: { type: "string", default: "repair" },
            seconds: { type: "string", default: "20" },
            "write-rate": { type: "string", default: "1" },
            "read-rate": { type: "string", default: "2" },
            "rebuild-every": { type: "string", default: "0" },
            journal: { type: "string", default: "delete" },
            "evidence-dir": { type: "string" },
        },
    });
    const size = integer(values.size, 1000, 100000);
    const page = integer(values.page, 50, 200);
    assert(page === 50 || page === 100 || page === 200);
    const seconds = integer(values.seconds, 2, 1800);
    const writeRate = integer(values["write-rate"], 1, 20);
    const readRate = integer(values["read-rate"], 1, 50);
    const rebuildEvery = integer(values["rebuild-every"], 0, 1800);
    assert(values.mode === "repair" || values.mode === "control");
    const mode = values.mode;
    assert(values.journal === "delete" || values.journal === "wal");
    const journal = values.journal;
    const evidenceDir = values["evidence-dir"]
        ? resolvePath(values["evidence-dir"])
        : await mkdtemp(join(os.tmpdir(), "latestnews-online-evidence-"));
    if (values["evidence-dir"]) await mkdir(evidenceDir, { mode: 0o700 });
    console.log("EVIDENCE:" + evidenceDir);
    const dir = await mkdtemp(join(os.tmpdir(), "latestnews-online-"));
    const path = join(dir, "fixture.sqlite");
    const workers: WorkerHandle[] = [];
    let db: ReturnType<typeof createDatabase> | undefined;
    let observer: WorkerHandle<PressureSample[]> | undefined;
    logger.level = 2;
    try {
        const fixtureDone = captureSpan("fixture");
        const pressureBefore = hostPressure();
        const config = await initializeOnlineFixture(path, size, journal);
        const fixture = fixtureDone();
        const pressureAfterFixture = hostPressure();
        db = createDatabase(sqliteConnector({ path }));
        const cache = new Cache(db, { sqliteBuildPage: page });
        await cache.check(false);
        const native = (await db.getInstance()) as NativeSqlite;
        native.pragma("synchronous = FULL");
        const sqlMetrics = instrumentSqlite(native);
        observer = startProcess<PressureSample[]>(["host-observer"], join(evidenceDir, "host.json"));
        workers.push(
            startWorker(path, "write", writeRate, size, page, evidenceDir),
            startWorker(path, "read", readRate, size, page, evidenceDir)
        );
        const readyDeadline = AbortSignal.timeout(15000);
        await Promise.race([
            Promise.all([...workers.map((w) => w.ready), observer.ready]),
            new Promise<never>((_, reject) => {
                readyDeadline.addEventListener("abort", () => reject(new Error("Worker readiness timeout")), {
                    once: true,
                });
            }),
        ]);
        const startAt = Date.now() + 250;
        const endAt = startAt + seconds * 1000;
        const start: OnlineStart = { startAt, endAt };
        for (const worker of workers) worker.child.send(start);
        observer.child.send(start);
        await delay(Math.max(0, startAt - Date.now()));
        const runtime = runtimeMetrics();
        const recovery: RecoveryWindow[] = [];
        let activeRepair: number | undefined;
        let nextRepair = mode === "repair" ? startAt : Infinity;
        const maintenance = {
            passes: 0,
            busy: 0,
            unavailable: 0,
            interrupted: 0,
            failed: 0,
            completed: 0,
            advanced: 0,
            maxPending: 0,
            maxOldestAgeMs: 0,
            maxPendingFts: 0,
            maxAttempts: 0,
        };
        const passTimes: number[] = [];
        const slow = slowSpans();
        const recordPass = async () => {
            const t = performance.now();
            const done = captureSpan("maintenance-pass");
            const result = await cache.runArticleMaintenance(5);
            slow.record(done());
            passTimes.push(performance.now() - t);
            maintenance.passes++;
            if (result.status === "busy") maintenance.busy++;
            if (result.status === "unavailable") maintenance.unavailable++;
            if (result.status === "interrupted") maintenance.interrupted++;
            maintenance.completed += result.completed;
            maintenance.advanced += result.advanced;
            maintenance.failed += result.failed;
            maintenance.maxPending = Math.max(maintenance.maxPending, result.remaining?.pendingIngest ?? 0);
            maintenance.maxOldestAgeMs = Math.max(maintenance.maxOldestAgeMs, result.remaining?.oldestAgeMs ?? 0);
            maintenance.maxPendingFts = Math.max(maintenance.maxPendingFts, result.pendingFts ?? 0);
            maintenance.maxAttempts = Math.max(maintenance.maxAttempts, result.remaining?.attempts ?? 0);
            runtime.sample();
            return result;
        };
        const queueWindows: Array<{
            elapsedSec: number;
            pending: number;
            oldestAgeMs: number;
            completed: number;
            rssBytes: number;
        }> = [];
        let nextSample = startAt;
        const hardStop = endAt + 120000;
        let settled = false;
        while (Date.now() < hardStop) {
            const now = Date.now();
            if (activeRepair === undefined && now < endAt && now >= nextRepair) {
                activeRepair = Date.now();
                await beginFtsRepair(db);
                nextRepair = rebuildEvery ? activeRepair + rebuildEvery * 1000 : Infinity;
            }
            const result = await recordPass();
            if (activeRepair !== undefined) {
                const state = await ftsRecoveryStatus(db);
                if (state.phase === "ready" && !state.pending && (await readFtsAudit(db, true)).status === "verified") {
                    recovery.push({ startedAt: activeRepair, endedAt: Date.now() });
                    activeRepair = undefined;
                }
            }
            if (now >= nextSample) {
                queueWindows.push({
                    elapsedSec: Math.round((now - startAt) / 1000),
                    pending: result.remaining?.pendingIngest ?? -1,
                    oldestAgeMs: result.remaining?.oldestAgeMs ?? 0,
                    completed: maintenance.completed,
                    rssBytes: process.memoryUsage().rss,
                });
                nextSample = now + 1000;
            }
            // Complete the offered load window before checking durable convergence.
            if (Date.now() >= endAt && activeRepair === undefined && result.status === "ok") {
                settled = true;
                break;
            }
            await delay(activeRepair === undefined ? 200 : 10);
        }
        // Retain maintenance diagnostics even if a worker result or final audit fails.
        await publishOnlineResult(join(evidenceDir, "maintenance.json"), {
            settled,
            recovery,
            maintenance,
            queueWindows,
            passLatency: distribution(passTimes),
            sql: sqlMetrics(),
            slow: slow.finish(),
            fixture,
            pressureBefore,
            pressureAfterFixture,
        });
        assert(settled, "Maintenance watchdog exceeded before convergence");
        const workerDeadline = AbortSignal.timeout(20000);
        const [writer, reader] = await Promise.race([
            Promise.all(workers.map((w) => w.done)),
            new Promise<never>((_, reject) =>
                workerDeadline.addEventListener("abort", () => reject(new Error("Worker finish timeout")), {
                    once: true,
                })
            ),
        ]);
        await Promise.all(workers.map((w) => w.exited));
        assert(
            workers.every((w) => w.child.exitCode === 0),
            "Worker process failed"
        );
        // A write in flight at the end of the offer window may commit after
        // the last poll. Drain again only after both workload processes exit.
        validateSlotResult(writer, "write", writeRate, seconds);
        validateSlotResult(reader, "read", readRate, seconds);
        const drainStart = performance.now();
        let drained = false;
        while (performance.now() - drainStart < 120000) {
            const r = await recordPass();
            if (r.status === "ok") {
                drained = true;
                break;
            }
            await delay(20);
        }
        const writes = summarizeWorker(writer, recovery);
        const reads = summarizeWorker(reader, recovery);
        // Preserve final audit failures in the report instead of throwing away
        // completed measurements. No SQL or payload is copied to the error.
        let correctness: Awaited<ReturnType<typeof verifyOnlineFixture>> | null = null;
        let correctnessError: string | undefined;
        try {
            correctness = await verifyOnlineFixture(path, size, writer.samples);
        } catch (error) {
            correctnessError =
                error instanceof assert.AssertionError ? "fixture-inconsistent" : "verification-unavailable";
            console.error("Final fixture verification failed:", correctnessError);
        }
        const probeDeadline = AbortSignal.timeout(20000);
        const pressure = await Promise.race([
            observer.done,
            new Promise<never>((_, reject) =>
                probeDeadline.addEventListener("abort", () => reject(new Error("Observer timeout")), { once: true })
            ),
        ]);
        await observer.exited;
        assert.equal(observer.child.exitCode, 0);

        const plannedRecoveries = mode === "control" ? 0 : rebuildEvery ? Math.ceil(seconds / rebuildEvery) : 1;
        const acceptance = evaluateOnlineAcceptance({
            writes,
            reads,
            maintenance,
            drained,
            correctnessPassed: correctness !== null,
            completedRecoveries: recovery.length,
            plannedRecoveries,
        });
        const runtimeResult = runtime.finish();
        const result = {
            ...acceptance,
            drained,
            plannedRecoveries,
            mode,
            size,
            page,
            seconds,
            writeRate,
            readRate,
            rebuildEvery,
            journal,
            diagnostics: { fixture, pressureBefore, pressureAfterFixture, pressure },
            environment: { node: process.version, cpu: os.cpus()[0]?.model, cores: os.cpus().length, sqlite: config },
            offeredLoadSeconds: (endAt - startAt) / 1000,
            elapsedThroughDrainMs: Date.now() - startAt,
            recovery: recovery.map((w) => ({
                startedAfterMs: w.startedAt - startAt,
                durationMs: w.endedAt - w.startedAt,
            })),
            recoveryMs: distribution(recovery.map((w) => w.endedAt - w.startedAt)),
            writes,
            reads,
            maintenance: {
                ...maintenance,
                passLatency: distribution(passTimes),
                queueWindows,
                sql: sqlMetrics(),
                runtime: runtimeResult,
                slow: slow.finish(),
            },
            correctness,
            ...(correctnessError ? { correctnessError } : {}),
            productionD1: false,
        };
        await publishOnlineResult(join(evidenceDir, "result.json"), result);
        console.log("RESULT:" + JSON.stringify(result));
        if (acceptance.result === "failed") process.exitCode = 1;
        else if (acceptance.result === "incomplete-load") process.exitCode = 2;
    } finally {
        if (observer && observer.child.exitCode === null && observer.child.signalCode === null)
            observer.child.kill("SIGKILL");
        if (observer) await observer.exited;
        for (const worker of workers)
            if (worker.child.exitCode === null && worker.child.signalCode === null) worker.child.kill("SIGKILL");
        await Promise.all(workers.map((w) => w.exited));
        if (db) await db.dispose();
        await rm(dir, { recursive: true, force: true });
    }
}

if (process.argv[2] === "host-observer") {
    const start = new Promise<OnlineStart>((resolve) => process.once("message", (m) => resolve(m as OnlineStart)));
    process.send?.({ kind: "ready" });
    const { startAt, endAt } = await start;
    try {
        await publishOnlineResult(process.argv[3], await runHostProbe(startAt, endAt));
    } finally {
        process.disconnect?.();
    }
} else if (process.argv[2] === "worker") {
    const [, , , path, role, rate, size, page, resultPath] = process.argv;
    assert(role === "read" || role === "write");
    const n = Number(page);
    assert(n === 50 || n === 100 || n === 200);
    try {
        await publishOnlineResult(resultPath, await runOnlineWorker(path, role, Number(rate), Number(size), n));
    } finally {
        process.disconnect?.();
    }
} else await main();
