import type { ChildProcess } from "node:child_process";

import os from "node:os";
import process from "node:process";
import { createServer } from "node:net";
import { fork } from "node:child_process";
import { performance } from "node:perf_hooks";
import { execFileSync } from "node:child_process";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { rm, open, mkdir, mkdtemp, copyFile, readFile, writeFile } from "node:fs/promises";

import { TTL } from "../../shared/consts";
import { bundlePluginPackage } from "../../crawler-platform/cli";
import { installCrawlerPluginPackage } from "../../crawler-platform/host/plugin-store";
import { type PerformanceCacheController, createPerformanceCacheController } from "./cache-controller";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const pluginId = "org.latestnews.performance";
const sourceIds = Array.from({ length: 30 }, (_, index) => {
    const number = String(index + 1).padStart(2, "0");
    return `ext.${pluginId}.source-${number}`;
});
const warmupRequestsPerScenario = 5;
const requestTimeoutMs = 30_000;
const serverMetricsProbeSource = `import { writeFileSync } from "node:fs";

const outputPath = process.env.LATESTNEWS_PERFORMANCE_METRICS_PATH;
let traceActive=false;
let traceValues={};
let traceOutcomes={};
let traceCount=0;
let traceDropped=0;
if(outputPath)globalThis[Symbol.for("latestnews.performance.trace")] = {
    record(span) {
        if(!traceActive)return;
        if(traceCount>=100000){traceDropped++;return;}
        if(typeof span.durationMs!=="number"||!Number.isFinite(span.durationMs))return;
        (traceValues[span.phase]??=[]).push(span.durationMs);
        const outcomes=traceOutcomes[span.phase]??={};
        outcomes[span.outcome]=(outcomes[span.outcome]??0)+1;
        traceCount++;
    }
};
const startedAt = Date.now();
const startCpu = process.cpuUsage();
const initialRssBytes = process.memoryUsage().rss;
let peakRssBytes = initialRssBytes;
let sampleCount = 1;
let finished = false;

const sample = () => {
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
    sampleCount += 1;
};
const timer = setInterval(sample, 250);
timer.unref();

const finish = () => {
    if (finished || !outputPath) return;
    finished = true;
    clearInterval(timer);
    sample();
    const elapsedMs = Math.max(1, Date.now() - startedAt);
    const cpu = process.cpuUsage(startCpu);
    writeFileSync(outputPath, JSON.stringify({
        sampleIntervalMs: 250,
        sampleCount,
        elapsedMs,
        initialRssBytes,
        peakRssBytes,
        cpuUserMicros: cpu.user,
        cpuSystemMicros: cpu.system,
        averageCpuPercent: ((cpu.user + cpu.system) / (elapsedMs * 1000)) * 100,
    }));
};

process.once("exit", finish);
if(outputPath)process.on("message",(message)=>{
    if(!message||typeof message!=="object")return;
    if(message.type==="latestnews-performance-trace-reset"){
        traceValues={};traceOutcomes={};traceCount=0;traceDropped=0;traceActive=true;
        process.send?.({type:"latestnews-performance-trace-ack",id:message.id});
    }else if(message.type==="latestnews-performance-trace-snapshot"){
        traceActive=false;
        process.send?.({type:"latestnews-performance-trace-ack",id:message.id,values:traceValues,outcomes:traceOutcomes,dropped:traceDropped});
    }else if(message.type==="latestnews-performance-stop"){finish();process.exit(0);}
});
`;

interface Options {
    samples: number;
    concurrency: number;
    sourceConcurrency: number;
}

interface RequestSpec {
    method: "GET" | "POST";
    path: string;
    body?: string;
    expectedSourceIds: string[];
    mayBePending?: string[];
}

interface RequestSample {
    durationMs: number;
    jsonParseMs: number;
    responseBytes: number;
    httpStatus: number;
    responseStatuses: string[];
    pendingSourceCount: number;
    errorCount: number;
}

interface TraceSnapshot {
    values: Record<string, number[]>;
    outcomes: Record<string, Record<string, number>>;
    dropped: number;
}
interface ScenarioReport {
    name: string;
    expectedStatusesPerRequest: Record<string, number>;
    statusMismatchCount: number;
    requestCount: number;
    concurrency: number;
    elapsedMs: number;
    requestsPerSecond: number;
    wallRequestsPerSecond: number;
    backgroundDrainMs: { p50: number; p95: number; p99: number };
    waves: number;
    phaseSpans: Record<
        string,
        { count: number; p50: number; p95: number; p99: number; outcomes: Record<string, number> }
    >;
    traceValid: boolean;
    expectedCollections: number;
    errorRate: number;
    cacheHitRate: number;
    pendingSourceCount: number;
    meanDecodedResponseBytes: number;
    responseStatuses: Record<string, number>;
    httpStatuses: Record<string, number>;
    latencyMs: { p50: number; p95: number; p99: number };
    jsonParseMs: { p50: number; p95: number; p99: number };
    latencySamplesMs: number[];
}

interface ScenarioDefinition {
    name: string;
    request: RequestSpec & { baseUrl: string };
    expectedStatusesPerRequest: Record<string, number>;
    prepareCache: () => void;
    waitForCache: () => Promise<void>;
}

async function main() {
    const options = parseOptions(process.argv.slice(2));
    const temporaryRoot = await mkdtemp(join(os.tmpdir(), "latestnews-performance-"));
    const workingDirectory = join(temporaryRoot, "server");
    const pluginStore = join(temporaryRoot, "plugins");
    const bundleDirectory = join(temporaryRoot, "bundle");
    const logPath = join(temporaryRoot, "server.log");
    const metricsPath = join(temporaryRoot, "server-metrics.json");
    let server: ChildProcess | undefined;
    let cacheController: PerformanceCacheController | undefined;
    let logHandle: Awaited<ReturnType<typeof open>> | undefined;
    let reportPath: string | undefined;

    try {
        await prepareTemporaryServer(temporaryRoot, workingDirectory, pluginStore, bundleDirectory);
        const port = await reserveLoopbackPort();
        const baseUrl = `http://127.0.0.1:${port}`;
        logHandle = await open(logPath, "a");
        const startupStartedAt = performance.now();
        server = startServer({
            logHandle,
            metricsPath,
            pluginStore,
            port,
            workingDirectory,
            sourceConcurrency: options.sourceConcurrency,
        });
        await waitForServer(server, baseUrl, requestTimeoutMs, logPath);
        const startupMs = round(performance.now() - startupStartedAt);

        cacheController = createPerformanceCacheController(join(workingDirectory, ".data/db.sqlite3"));
        await warmSourceCache(baseUrl, cacheController);
        const scenarios: ScenarioReport[] = [];
        for (const scenario of createScenarios(baseUrl, cacheController)) {
            scenarios.push(await runScenario(scenario, options, server));
            console.error("Completed " + scenario.name);
        }
        const passed = scenarios.every(
            (scenario) => scenario.errorRate === 0 && scenario.statusMismatchCount === 0 && scenario.traceValid
        );

        cacheController.close();
        cacheController = undefined;
        await stopServer(server);
        server = undefined;
        await logHandle.close();
        logHandle = undefined;

        const packageJson = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8")) as {
            version: string;
        };
        const report = {
            result: passed ? "passed" : "failed",
            formatVersion: 3,
            capturedAt: new Date().toISOString(),
            git: readGitState(),
            packageVersion: packageJson.version,
            runtime: {
                node: process.version,
                pnpm: readPnpmVersion(),
                platform: process.platform,
                architecture: process.arch,
                operatingSystem: os.version(),
                operatingSystemRelease: os.release(),
                cpuModel: os.cpus()[0]?.model ?? "unknown",
                logicalCores: os.cpus().length,
                totalMemoryBytes: os.totalmem(),
            },
            target: {
                url: baseUrl,
                network: "loopback only; fixture plugin has no network permissions",
            },
            workload: {
                cacheMode:
                    "SQLite hit, cold miss, partial miss and stale cache; target rows reset between request waves",
                cachePreparationExcludedFromRequestTiming: true,
                fixtureSourceCount: sourceIds.length,
                fixtureItemsPerSource: 30,
                warmupRequestsPerScenario,
                samples: options.samples,
                concurrency: options.concurrency,
                sourceConcurrency: options.sourceConcurrency,
                responseWindowThroughputExcludesDrain: true,
                wallThroughputIncludesPreparationAndDrain: true,
                phaseSpansExcludeWarmup: true,
                phaseSpansOverlapAndAreNotAdditive: true,
            },
            startupMs,
            serverProcess: await readServerMetrics(metricsPath),
            scenarios,
        };

        reportPath = getReportPath(report.git.commit);
        await mkdir(dirname(reportPath), { recursive: true });
        await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
        process.stdout.write(
            `${JSON.stringify(
                {
                    result: report.result,
                    reportPath,
                    startupMs,
                    scenarios: scenarios.map(
                        ({
                            name,
                            latencyMs,
                            requestsPerSecond,
                            wallRequestsPerSecond,
                            backgroundDrainMs,
                            traceValid,
                            expectedCollections,
                            phaseSpans,
                            errorRate,
                            cacheHitRate,
                            statusMismatchCount,
                            pendingSourceCount,
                        }) => ({
                            name,
                            latencyMs,
                            requestsPerSecond: round(requestsPerSecond),
                            wallRequestsPerSecond,
                            backgroundDrainMs,
                            traceValid,
                            expectedCollections,
                            phaseSpans,
                            errorRate,
                            cacheHitRate,
                            statusMismatchCount,
                            pendingSourceCount,
                        })
                    ),
                },
                null,
                2
            )}\n`
        );
        if (!passed)
            throw new Error(
                `The cache-state baseline had API errors or response-status mismatches. See ${reportPath}.`
            );
    } catch (error) {
        console.error(await readLogTail(logPath));
        throw error;
    } finally {
        cacheController?.close();
        if (server) await stopServer(server);
        await logHandle?.close();
        await rm(temporaryRoot, { recursive: true, force: true });
    }
}

/** Bundle and install the local fixture in a store isolated from the user's application data. */
async function prepareTemporaryServer(
    temporaryRoot: string,
    workingDirectory: string,
    pluginStore: string,
    bundleDirectory: string
) {
    const serverEntry = join(projectRoot, "dist/output/server/index.mjs");
    const workerSource = join(projectRoot, "crawler-platform/runtime/worker-entry.mjs");
    const pluginSource = join(projectRoot, "crawler-platform/examples/performance");
    await mkdir(workingDirectory, { recursive: true });
    await mkdir(join(workingDirectory, "crawler-platform/runtime"), { recursive: true });
    await mkdir(join(temporaryRoot, "tmp"), { recursive: true });
    await mkdir(join(temporaryRoot, "home"), { recursive: true });
    await mkdir(join(temporaryRoot, "appdata"), { recursive: true });
    await mkdir(join(temporaryRoot, "local-appdata"), { recursive: true });
    await copyFile(workerSource, join(workingDirectory, "crawler-platform/runtime/worker-entry.mjs"));
    await writeFile(join(temporaryRoot, "server-metrics.mjs"), serverMetricsProbeSource, "utf8");
    await bundlePluginPackage(pluginSource, bundleDirectory);
    await installCrawlerPluginPackage(bundleDirectory, pluginStore, { action: "install", enable: true });
    await assertFileExists(serverEntry, "Run `pnpm build` before starting the performance benchmark.");
}

/** Start the built Nitro server with only the environment required by this isolated local run. */
function startServer({
    logHandle,
    metricsPath,
    pluginStore,
    port,
    workingDirectory,
    sourceConcurrency,
}: {
    logHandle: Awaited<ReturnType<typeof open>>;
    metricsPath: string;
    pluginStore: string;
    port: number;
    workingDirectory: string;
    sourceConcurrency: number;
}) {
    const environment = createServerEnvironment({
        metricsPath,
        pluginStore,
        port,
        workingDirectory,
        sourceConcurrency,
    });
    const serverEntry = join(projectRoot, "dist/output/server/index.mjs");
    const metricsModule = join(dirname(metricsPath), "server-metrics.mjs");
    const child = fork(serverEntry, [], {
        cwd: workingDirectory,
        env: environment,
        execArgv: ["--import", pathToFileURL(metricsModule).href],
        stdio: ["ignore", logHandle.fd, logHandle.fd, "ipc"],
    });
    return child;
}

function createServerEnvironment({
    metricsPath,
    pluginStore,
    port,
    workingDirectory,
    sourceConcurrency,
}: {
    metricsPath: string;
    pluginStore: string;
    port: number;
    workingDirectory: string;
    sourceConcurrency: number;
}) {
    const temporaryHome = join(dirname(workingDirectory), "home");
    const environment: NodeJS.ProcessEnv = {
        PATH: process.env.PATH,
        NODE_ENV: "production",
        HOST: "127.0.0.1",
        NITRO_HOST: "127.0.0.1",
        PORT: String(port),
        NITRO_PORT: String(port),
        ENABLE_CACHE: "true",
        INIT_TABLE: "true",
        LATESTNEWS_SOURCE_MAX_CONCURRENT: String(sourceConcurrency),
        LATESTNEWS_CRAWLER_PLUGIN_DIR: pluginStore,
        LATESTNEWS_CRAWLER_PLUGIN_IDS: pluginId,
        LATESTNEWS_PERFORMANCE_METRICS_PATH: metricsPath,
        HOME: temporaryHome,
        USERPROFILE: temporaryHome,
        TMP: join(dirname(workingDirectory), "tmp"),
        TEMP: join(dirname(workingDirectory), "tmp"),
        APPDATA: join(dirname(workingDirectory), "appdata"),
        LOCALAPPDATA: join(dirname(workingDirectory), "local-appdata"),
    };

    for (const key of ["SystemRoot", "WINDIR", "COMSPEC", "PATHEXT", "LANG", "LC_ALL", "TMPDIR"] as const) {
        const value = process.env[key];
        if (value !== undefined) environment[key] = value;
    }
    return environment;
}

/** Wait for the local health endpoint and fail with bounded server logs on startup errors. */
async function waitForServer(server: ChildProcess, baseUrl: string, timeoutMs: number, logPath: string) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (server.exitCode !== null || server.signalCode !== null) {
            throw new Error(`Local Node server exited before readiness.\n${await readLogTail(logPath)}`);
        }
        try {
            const response = await fetch(`${baseUrl}/api/v1/health/deployment`, {
                signal: AbortSignal.timeout(1000),
            });
            if (response.ok) return;
        } catch {
            // Retry only while the bounded startup window remains open.
        }
        await delay(200);
    }
    throw new Error(`Local Node server did not become ready within ${timeoutMs} ms.\n${await readLogTail(logPath)}`);
}

async function waitForSettledCache(cache: PerformanceCacheController, ids: string[]) {
    const deadline = Date.now() + requestTimeoutMs;
    while (!cache.isSettled(ids)) {
        if (Date.now() >= deadline) throw new Error("Background cache/index writes did not settle for the wave.");
        await delay(25);
    }
}

async function warmSourceCache(baseUrl: string, cache: PerformanceCacheController) {
    // Seed in bounded groups. Cold 30-source behavior is measured separately.
    for (let offset = 0; offset < sourceIds.length; offset += 5) {
        const ids = sourceIds.slice(offset, offset + 5);
        const request = createBatchRequest(ids);
        const result = await executeRequest(baseUrl, request);
        assertExpectedSample(result, createScenario(baseUrl, "cache warmup", request, { success: ids.length }));
        await waitForSettledCache(cache, ids);
    }
    await waitForSettledCache(cache, sourceIds);

    const verify = await executeRequest(baseUrl, createSingleRequest(sourceIds[0]!));
    assertExpectedSample(
        verify,
        createScenario(baseUrl, "cache warmup verification", createSingleRequest(sourceIds[0]!), { cache: 1 })
    );
}

function createScenarios(baseUrl: string, cacheController: PerformanceCacheController) {
    const singleSourceIds = sourceIds.slice(0, 1);
    const batch10SourceIds = sourceIds.slice(0, 10);
    const cachedHalf = sourceIds.slice(0, 15);
    const missingHalf = sourceIds.slice(15);

    const settle = () => waitForSettledCache(cacheController, sourceIds);
    const scenarios = [
        createScenario(baseUrl, "single-source-cache-hit", createSingleRequest(singleSourceIds[0]!), { cache: 1 }),
        createScenario(baseUrl, "batch-10-sources-cache-hit", createBatchRequest(batch10SourceIds), { cache: 10 }),
        createScenario(baseUrl, "batch-30-sources-cache-hit", createBatchRequest(sourceIds), { cache: 30 }),
        createScenario(
            baseUrl,
            "single-source-cold-cache-miss",
            createSingleRequest(singleSourceIds[0]!),
            { success: 1 },
            () => cacheController.clear(singleSourceIds)
        ),
        createScenario(
            baseUrl,
            "batch-10-sources-cold-cache-miss",
            createBatchRequest(batch10SourceIds),
            { success: 10 },
            () => cacheController.clear(batch10SourceIds)
        ),
        createScenario(
            baseUrl,
            "batch-30-sources-cold-cache-miss",
            createBatchRequest(sourceIds),
            { success: 30 },
            () => cacheController.clear(sourceIds)
        ),
        createScenario(
            baseUrl,
            "batch-30-sources-partial-cache-miss",
            { ...createBatchRequest(sourceIds), mayBePending: missingHalf },
            { cache: cachedHalf.length, success: missingHalf.length },
            () => cacheController.clear(missingHalf),
            settle
        ),
        createScenario(
            baseUrl,
            "batch-30-sources-stale-cache",
            createBatchRequest(sourceIds),
            { "stale-cache": 30 },
            () => cacheController.setUpdatedAt(sourceIds, Date.now() - TTL - 1)
        ),
    ];
    return scenarios.map((scenario) => ({ ...scenario, waitForCache: settle }));
}

function createScenario(
    baseUrl: string,
    name: string,
    request: RequestSpec,
    expectedStatusesPerRequest: Record<string, number>,
    prepareCache: () => void = () => undefined,
    waitForCache: () => Promise<void> = () => Promise.resolve()
): ScenarioDefinition {
    return { name, request: { ...request, baseUrl }, expectedStatusesPerRequest, prepareCache, waitForCache };
}

function createSingleRequest(sourceId: string): RequestSpec {
    return {
        method: "GET",
        path: `/api/v1/sources/${encodeURIComponent(sourceId)}/items?latest=false`,
        expectedSourceIds: [sourceId],
    };
}

function createBatchRequest(ids: string[]): RequestSpec {
    return {
        method: "POST",
        path: "/api/v1/sources/batch",
        body: JSON.stringify({ sources: ids }),
        expectedSourceIds: ids,
    };
}

let nextTraceRequest = 0;
async function traceControl(server: ChildProcess, action: "reset" | "snapshot"): Promise<Partial<TraceSnapshot>> {
    const id = ++nextTraceRequest;
    return new Promise((resolveAck, reject) => {
        const timer = setTimeout(() => {
            cleanup();
            reject(new Error("Benchmark trace control timed out"));
        }, 5000);
        const cleanup = () => {
            clearTimeout(timer);
            server.off("message", onMessage);
        };
        const onMessage = (message: unknown) => {
            if (!isRecord(message) || message.type !== "latestnews-performance-trace-ack" || message.id !== id) return;
            cleanup();
            resolveAck(message as Partial<TraceSnapshot>);
        };
        server.on("message", onMessage);
        server.send({ type: "latestnews-performance-trace-" + action, id }, (error) => {
            if (error) {
                cleanup();
                reject(error);
            }
        });
    });
}

async function runScenario(
    scenario: ScenarioDefinition,
    options: Options,
    server: ChildProcess
): Promise<ScenarioReport> {
    for (let index = 0; index < warmupRequestsPerScenario; index += 1) {
        scenario.prepareCache();
        const sample = await executeRequest(scenario.request.baseUrl, scenario.request);
        assertExpectedSample(sample, scenario);
        await scenario.waitForCache();
    }

    await traceControl(server, "reset");
    const samples: RequestSample[] = [];
    let elapsedMs = 0;
    const drainTimes: number[] = [];
    const wallStartedAt = performance.now();
    while (samples.length < options.samples) {
        scenario.prepareCache();
        const waveSize = Math.min(options.concurrency, options.samples - samples.length);
        const startedAt = performance.now();
        const wave = await Promise.all(
            Array.from({ length: waveSize }, () => executeRequest(scenario.request.baseUrl, scenario.request))
        );
        elapsedMs += Math.max(0.001, performance.now() - startedAt);
        samples.push(...wave);
        const drainStartedAt = performance.now();
        await scenario.waitForCache();
        drainTimes.push(performance.now() - drainStartedAt);
    }

    const wallElapsedMs = Math.max(0.001, performance.now() - wallStartedAt);
    const trace = await traceControl(server, "snapshot");
    if (!trace.values || !trace.outcomes || typeof trace.dropped !== "number")
        throw new Error("Missing benchmark phase spans.");
    const phaseSpans = Object.fromEntries(
        Object.entries(trace.values).map(([phase, values]) => [
            phase,
            { count: values.length, ...summarize(values), outcomes: trace.outcomes![phase] ?? {} },
        ])
    );
    const expectedCollections = (scenario.expectedStatusesPerRequest.success ?? 0) * drainTimes.length;
    const commits = phaseSpans["cache.commit"]?.count ?? 0;
    const traceValid =
        trace.dropped === 0 &&
        phaseSpans["cache.read"]?.count === samples.length &&
        ["source.queue", "source.collect", "source.normalize"].every(
            (phase) => (phaseSpans[phase]?.count ?? 0) === expectedCollections
        ) &&
        commits >= expectedCollections &&
        ["index.queue", "index.replay", "index.repair"].every((phase) => (phaseSpans[phase]?.count ?? 0) === commits) &&
        Object.values(phaseSpans).every((span) => span.outcomes.success === span.count);
    const statuses = countValues(samples.flatMap((sample) => sample.responseStatuses));
    const httpStatuses = countValues(samples.map((sample) => String(sample.httpStatus)));
    const statusMismatchCount = samples.filter((sample) => !hasExpectedResponseStatuses(sample, scenario)).length;
    const cacheResponses = samples.reduce(
        (count, sample) =>
            count +
            sample.responseStatuses.filter((status) => ["cache", "degraded-cache", "stale-cache"].includes(status))
                .length,
        0
    );
    const totalResponses = samples.reduce((count, sample) => count + sample.responseStatuses.length, 0);
    const errorCount = samples.filter((sample) => sample.errorCount > 0).length;

    return {
        name: scenario.name,
        expectedStatusesPerRequest: scenario.expectedStatusesPerRequest,
        statusMismatchCount,
        requestCount: samples.length,
        concurrency: Math.min(options.concurrency, options.samples),
        elapsedMs: round(elapsedMs),
        requestsPerSecond: round((samples.length / elapsedMs) * 1000, 2),
        wallRequestsPerSecond: round((samples.length / wallElapsedMs) * 1000, 2),
        backgroundDrainMs: summarize(drainTimes),
        waves: drainTimes.length,
        phaseSpans,
        traceValid,
        expectedCollections,
        errorRate: round(errorCount / samples.length, 6),
        cacheHitRate: round(totalResponses === 0 ? 0 : cacheResponses / totalResponses, 6),
        pendingSourceCount: samples.reduce((count, sample) => count + sample.pendingSourceCount, 0),
        meanDecodedResponseBytes: Math.round(
            samples.reduce((total, sample) => total + sample.responseBytes, 0) / samples.length
        ),
        responseStatuses: statuses,
        httpStatuses,
        latencyMs: summarize(samples.map((sample) => sample.durationMs)),
        jsonParseMs: summarize(samples.map((sample) => sample.jsonParseMs)),
        latencySamplesMs: samples.map((sample) => round(sample.durationMs, 3)),
    };
}

/** Measure complete local HTTP responses and retain API cache/error status counts. */
async function executeRequest(baseUrl: string, request: RequestSpec): Promise<RequestSample> {
    const startedAt = performance.now();
    try {
        const response = await fetch(new URL(request.path, baseUrl), {
            method: request.method,
            ...(request.body ? { body: request.body } : {}),
            ...(request.body ? { headers: { "content-type": "application/json" } } : {}),
            signal: AbortSignal.timeout(requestTimeoutMs),
        });
        const body = await response.text();
        const responseAt = performance.now();
        let payload: unknown;
        let errorCount = response.ok ? 0 : 1;
        try {
            payload = JSON.parse(body) as unknown;
        } catch {
            errorCount += 1;
        }
        const parsedAt = performance.now();
        const responseStatuses = extractResponseStatuses(payload);
        const pendingSourceIds = getPendingSourceIds(payload);
        if (!hasExpectedSources(payload, request, pendingSourceIds)) errorCount += 1;
        if (extractApiErrorCount(payload) > 0) errorCount += 1;

        return {
            durationMs: responseAt - startedAt,
            jsonParseMs: parsedAt - responseAt,
            responseBytes: Buffer.byteLength(body),
            httpStatus: response.status,
            responseStatuses,
            pendingSourceCount: pendingSourceIds.length,
            errorCount,
        };
    } catch {
        return {
            durationMs: performance.now() - startedAt,
            jsonParseMs: 0,
            responseBytes: 0,
            httpStatus: 0,
            responseStatuses: [],
            pendingSourceCount: 0,
            errorCount: 1,
        };
    }
}

function extractResponseStatuses(payload: unknown) {
    if (!isRecord(payload)) return [];
    const data = payload.data;
    const rows = Array.isArray(data) ? data : isRecord(data) ? [data] : [];
    return rows.map((row) => (isRecord(row) && typeof row.status === "string" ? row.status : "unknown"));
}

function getPendingSourceIds(payload: unknown): unknown[] {
    if (!isRecord(payload) || !isRecord(payload.meta) || !Array.isArray(payload.meta.omittedSourceIds)) return [];
    return payload.meta.omittedSourceIds;
}

function hasExpectedSources(payload: unknown, request: RequestSpec, pendingSourceIds: unknown[]) {
    if (!isRecord(payload)) return false;
    const data = payload.data;
    const rows = Array.isArray(data) ? data : isRecord(data) ? [data] : [];
    const expectedIds = new Set<unknown>(request.expectedSourceIds);
    const mayBePending = new Set<unknown>(request.mayBePending);
    const actualIds = new Set(rows.map((row) => (isRecord(row) ? row.id : undefined)));
    if (actualIds.size !== rows.length || rows.length + pendingSourceIds.length !== expectedIds.size) return false;
    if (pendingSourceIds.length && (!isRecord(payload.meta) || payload.meta.partial !== true)) return false;
    if (!rows.every((row) => isRecord(row) && expectedIds.has(row.id))) return false;
    if (!pendingSourceIds.every((id) => mayBePending.has(id) && !actualIds.has(id))) return false;
    if (new Set(pendingSourceIds).size !== pendingSourceIds.length) return false;
    return (
        !request.mayBePending ||
        rows.every((row) => isRecord(row) && (mayBePending.has(row.id) || row.status === "cache"))
    );
}

function extractApiErrorCount(payload: unknown) {
    if (!isRecord(payload) || !Array.isArray(payload.errors)) return 0;
    return payload.errors.length;
}

function assertExpectedSample(sample: RequestSample, scenario: ScenarioDefinition) {
    if (
        sample.httpStatus < 200 ||
        sample.httpStatus >= 300 ||
        sample.errorCount > 0 ||
        !hasExpectedResponseStatuses(sample, scenario)
    ) {
        throw new Error(
            `Scenario ${scenario.name} expected ${JSON.stringify(scenario.expectedStatusesPerRequest)} but received HTTP ${sample.httpStatus} ` +
                `with statuses ${JSON.stringify(countValues(sample.responseStatuses))}, ${sample.pendingSourceCount} pending and ${sample.errorCount} errors.`
        );
    }
}

function hasExpectedResponseStatuses(sample: RequestSample, scenario: ScenarioDefinition) {
    const expectedStatuses = scenario.expectedStatusesPerRequest;
    const actualStatuses = countValues(sample.responseStatuses);
    if (scenario.request.mayBePending) {
        return (
            (actualStatuses.cache ?? 0) >= expectedStatuses.cache! &&
            (actualStatuses.cache ?? 0) + (actualStatuses.success ?? 0) + sample.pendingSourceCount ===
                scenario.request.expectedSourceIds.length
        );
    }
    const expectedKeys = Object.keys(expectedStatuses).sort();
    const actualKeys = Object.keys(actualStatuses).sort();
    return (
        expectedKeys.length === actualKeys.length &&
        expectedKeys.every(
            (status, index) => status === actualKeys[index] && expectedStatuses[status] === actualStatuses[status]
        )
    );
}

function summarize(values: number[]) {
    const sorted = values.toSorted((left, right) => left - right);
    return {
        p50: round(percentile(sorted, 0.5), 3),
        p95: round(percentile(sorted, 0.95), 3),
        p99: round(percentile(sorted, 0.99), 3),
    };
}

function percentile(sorted: number[], quantile: number) {
    if (sorted.length === 0) return 0;
    const index = Math.max(0, Math.ceil(sorted.length * quantile) - 1);
    return sorted[index] ?? 0;
}

function countValues(values: string[]) {
    return values.reduce<Record<string, number>>((counts, value) => {
        counts[value] = (counts[value] ?? 0) + 1;
        return counts;
    }, {});
}

async function reserveLoopbackPort() {
    const server = createServer();
    await new Promise<void>((resolveListen, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolveListen);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Could not reserve a local benchmark port.");
    await new Promise<void>((resolveClose, reject) =>
        server.close((error) => (error ? reject(error) : resolveClose()))
    );
    return address.port;
}

async function stopServer(server: ChildProcess) {
    if (server.exitCode !== null || server.signalCode !== null) return;
    if (server.connected) server.send({ type: "latestnews-performance-stop" });
    else server.kill("SIGTERM");
    await Promise.race([waitForExit(server), delay(5000)]);
    if (server.exitCode === null && server.signalCode === null) server.kill();
    await waitForExit(server);
}

function waitForExit(server: ChildProcess) {
    if (server.exitCode !== null || server.signalCode !== null) return Promise.resolve();
    return new Promise<void>((resolveExit) => server.once("exit", () => resolveExit()));
}

async function readServerMetrics(path: string) {
    try {
        return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    } catch {
        throw new Error("The local Node server did not write its CPU and RSS sample.");
    }
}

function readGitState() {
    try {
        const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: projectRoot, encoding: "utf8" }).trim();
        const status = execFileSync("git", ["status", "--porcelain"], { cwd: projectRoot, encoding: "utf8" });
        return { commit, workingTreeDirty: status.trim().length > 0 };
    } catch {
        return { commit: "unknown", workingTreeDirty: true };
    }
}

function readPnpmVersion() {
    const userAgent = process.env.npm_config_user_agent ?? "";
    return /(?:^|\s)pnpm\/([^\s]+)/.exec(userAgent)?.[1] ?? "unknown";
}

function getReportPath(commit: string) {
    const stamp = new Date().toISOString().replaceAll(":", "-");
    return join(projectRoot, ".data/performance", `${stamp}-${commit.slice(0, 12)}.json`);
}

async function readLogTail(path: string) {
    try {
        return (await readFile(path, "utf8")).split(/\r?\n/).slice(-60).join("\n");
    } catch {
        return "No server log was written.";
    }
}

async function assertFileExists(path: string, message: string) {
    try {
        await readFile(path);
    } catch {
        throw new Error(message);
    }
}

function parseOptions(args: string[]): Options {
    const values = new Map<string, string>();
    for (let index = 0; index < args.length; index += 1) {
        const key = args[index];
        if (!key?.startsWith("--") || !["--samples", "--concurrency", "--source-concurrency"].includes(key)) {
            throw new Error(
                "Usage: pnpm performance:baseline [--samples 1000] [--concurrency 30] [--source-concurrency 8]"
            );
        }
        const value = args[index + 1];
        if (!value || value.startsWith("--")) throw new Error(`Missing value for ${key}.`);
        values.set(key, value);
        index += 1;
    }

    const samples = parseInteger(values.get("--samples") ?? "1000", "--samples", 1, 10_000);
    const concurrency = parseInteger(values.get("--concurrency") ?? "30", "--concurrency", 1, 100);
    const sourceConcurrency = parseInteger(values.get("--source-concurrency") ?? "8", "--source-concurrency", 1, 16);
    return { samples, concurrency, sourceConcurrency };
}

function parseInteger(value: string, option: string, minimum: number, maximum: number) {
    if (!/^\d+$/.test(value)) throw new Error(`${option} must be a positive integer.`);
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
        throw new Error(`${option} must be from ${minimum} to ${maximum}.`);
    }
    return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function round(value: number, digits = 2) {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}

function delay(milliseconds: number) {
    return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
});
