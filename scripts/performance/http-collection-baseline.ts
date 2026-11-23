import os from "node:os";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";

import { createSourceEngine } from "../../server/utils/source-engine";
import { createFetchScheduler } from "../../server/utils/fetch-scheduler";
import {
    fixtureBehavior,
    summarizeLatencies,
    startLoopbackFixtures,
    HTTP_BENCHMARK_SCENARIOS,
} from "./http-collection-fixture";

import type { NewsItem, SourceID } from "../../shared/types";
import type { CollectionTraceSpan } from "../../server/utils/collection-trace";
import type { LoopbackFixture, HttpBenchmarkScenario } from "./http-collection-fixture";

export interface HttpCollectionBenchmarkOptions {
    samples: number;
    clientConcurrency: number;
    sourceConcurrency: number[];
    seed: number;
    scenarios: HttpBenchmarkScenario[];
    output: string;
    smoke: boolean;
    help: boolean;
}

interface RequestOutcome {
    durationMs: number;
    result: "success" | "http_429" | "http_503" | "cancelled" | "unexpected";
    matched: boolean;
}

class FixtureHttpError extends Error {
    constructor(readonly status: number) {
        super("The fixture returned HTTP " + status + ".");
        this.name = "FixtureHttpError";
    }
}

export function parseHttpCollectionBenchmarkOptions(args: readonly string[]): HttpCollectionBenchmarkOptions {
    const options: HttpCollectionBenchmarkOptions = {
        samples: 1000,
        clientConcurrency: 30,
        sourceConcurrency: [4, 6, 8],
        seed: 20261123,
        scenarios: [...HTTP_BENCHMARK_SCENARIOS],
        output: ".data/performance/http-collection-baseline.json",
        smoke: false,
        help: false,
    };
    for (let i = 0; i < args.length; i += 1) {
        const argument = args[i]!;
        if (argument === "--") continue;
        if (argument === "--help" || argument === "-h") {
            options.help = true;
            continue;
        }
        if (argument === "--smoke") {
            options.smoke = true;
            continue;
        }
        const separator = argument.indexOf("=");
        const key = separator === -1 ? argument : argument.slice(0, separator);
        const next = separator === -1 ? args[++i] : argument.slice(separator + 1);
        if (!next) throw new Error("Missing value for " + key + ".");
        switch (key) {
            case "--samples":
                options.samples = parseInteger(key, next, 1, 100000);
                break;
            case "--clients":
                options.clientConcurrency = parseInteger(key, next, 1, 100);
                break;
            case "--source-concurrency":
                options.sourceConcurrency = parseIntegerList(key, next, 1, 16);
                break;
            case "--seed":
                options.seed = parseInteger(key, next, 0, 4294967295);
                break;
            case "--scenarios": {
                const scenarios = [...new Set(next.split(",").map((entry) => entry.trim()))];
                if (
                    !scenarios.length ||
                    scenarios.some((entry) => !HTTP_BENCHMARK_SCENARIOS.includes(entry as HttpBenchmarkScenario))
                ) {
                    throw new Error("Invalid scenario. Choose from: " + HTTP_BENCHMARK_SCENARIOS.join(", "));
                }
                options.scenarios = scenarios as HttpBenchmarkScenario[];
                break;
            }
            case "--output":
                options.output = next;
                break;
            default:
                throw new Error("Unknown option " + key + ".");
        }
    }
    if (!options.smoke && !options.help && options.samples < 1000) {
        throw new Error(
            "Comparable measurements require at least 1000 samples per scenario and configuration. Use --smoke for a short check."
        );
    }
    return options;
}

function parseInteger(name: string, value: string, minimum: number, maximum: number) {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
        throw new RangeError(name + " must be an integer between " + minimum + " and " + maximum + ".");
    }
    return parsed;
}

function parseIntegerList(name: string, value: string, minimum: number, maximum: number) {
    const result = [...new Set(value.split(",").map((entry) => parseInteger(name, entry.trim(), minimum, maximum)))];
    if (!result.length) throw new Error(name + " cannot be empty.");
    return result;
}

function readCommit() {
    try {
        return execFileSync("git", ["rev-parse", "HEAD"], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
        }).trim();
    } catch {
        return "unknown";
    }
}

async function warmupFixtures(fixtures: readonly LoopbackFixture[], seed: number) {
    for (const fixture of fixtures) {
        for (let index = 0; index < 5; index += 1) {
            const url = new URL("/feed", fixture.origin);
            url.searchParams.set("scenario", "fixed-spread");
            url.searchParams.set("sampleId", String(100000 + index));
            url.searchParams.set("seed", String(seed));
            const response = await fetch(url);
            if (!response.ok) throw new Error("Fixture warmup failed.");
            await response.arrayBuffer();
        }
    }
    for (const fixture of fixtures) fixture.reset();
}

async function settleFixtureQueues(
    scheduler: ReturnType<typeof createFetchScheduler>,
    fixtures: readonly LoopbackFixture[]
) {
    const deadline = performance.now() + 10000;
    while (scheduler.activeCount || scheduler.queuedCount || fixtures.some((fixture) => fixture.snapshot().active)) {
        if (performance.now() >= deadline)
            throw new Error("Fixture/scheduler did not become idle before the next scenario.");
        await new Promise<void>((done) => setTimeout(done, 5));
    }
}

export async function runHttpCollectionScenario(
    scenario: HttpBenchmarkScenario,
    sourceConcurrency: number,
    options: HttpCollectionBenchmarkOptions,
    fixtures: readonly LoopbackFixture[]
) {
    if (fixtures.length < 4) throw new Error("Four isolated loopback origins are required.");
    await warmupFixtures(fixtures, options.seed);

    const spans: CollectionTraceSpan[] = [];
    const trace = { record: (span: CollectionTraceSpan) => spans.push(span) };
    const scheduler = createFetchScheduler({
        maxConcurrent: 8,
        maxPerKey: 2,
        maxQueued: 100,
        queueTimeoutMs: 8000,
        taskTimeoutMs: 8000,
        trace,
    });

    let activeCollectors = 0;
    let maxSourceActive = 0;
    let activeHttp = 0;
    let maxHttpActive = 0;
    let sourceSuccess = 0;
    let sourceFailure = 0;
    const sourcePrefix = "perf.n4c." + scenario + ".";
    const engine = createSourceEngine({
        maxConcurrent: sourceConcurrency,
        maxQueued: 100,
        queueTimeoutMs: 8000,
        trace,
        resolveAdapter: (sourceId: SourceID) => {
            const sampleId = Number(sourceId.slice(sourcePrefix.length));
            if (!sourceId.startsWith(sourcePrefix) || !Number.isSafeInteger(sampleId) || sampleId < 0) return undefined;
            const fixture = fixtures[scenario === "single-origin" ? 0 : sampleId % fixtures.length]!;
            const origin = new URL(fixture.origin).origin;
            const url = new URL("/feed", fixture.origin);
            url.searchParams.set("scenario", scenario);
            url.searchParams.set("sampleId", String(sampleId));
            url.searchParams.set("seed", String(options.seed));

            return {
                descriptor: { id: sourceId, kind: "legacy" as const },
                async collect({ signal }: { signal: AbortSignal }): Promise<NewsItem[]> {
                    activeCollectors += 1;
                    maxSourceActive = Math.max(maxSourceActive, activeCollectors);
                    try {
                        return await scheduler.run(
                            origin,
                            async (httpSignal) => {
                                activeHttp += 1;
                                maxHttpActive = Math.max(maxHttpActive, activeHttp);
                                try {
                                    const response = await fetch(url, { signal: httpSignal });
                                    const item = (await response.json()) as NewsItem;
                                    if (!response.ok) throw new FixtureHttpError(response.status);
                                    return [item];
                                } finally {
                                    activeHttp -= 1;
                                }
                            },
                            signal
                        );
                    } finally {
                        activeCollectors -= 1;
                    }
                },
            };
        },
        onSuccess: () => {
            sourceSuccess += 1;
        },
        onFailure: () => {
            sourceFailure += 1;
        },
    });
    let nextIndex = 0;
    const outcomes: RequestOutcome[] = Array.from({ length: options.samples });
    const runStarted = performance.now();

    try {
        await Promise.all(
            Array.from({ length: Math.min(options.clientConcurrency, options.samples) }, async () => {
                while (nextIndex < options.samples) {
                    const sampleId = nextIndex++;
                    const expected = fixtureBehavior(scenario, sampleId, options.seed);
                    const controller = new AbortController();
                    const timeout = expected.cancelByClient ? setTimeout(() => controller.abort(), 3) : undefined;
                    const started = performance.now();
                    let result: RequestOutcome["result"] = "unexpected";
                    let matched = false;
                    try {
                        const items = await engine.collect((sourcePrefix + sampleId) as SourceID, {
                            signal: controller.signal,
                        });
                        result = "success";
                        matched =
                            !expected.cancelByClient &&
                            expected.status === 200 &&
                            items.length === 1 &&
                            items[0]!.id === "fixture-" + sampleId;
                    } catch (error) {
                        if (
                            typeof error === "object" &&
                            error !== null &&
                            "code" in error &&
                            error.code === "CANCELLED"
                        ) {
                            result = "cancelled";
                            matched = expected.cancelByClient;
                        } else if (error instanceof FixtureHttpError) {
                            result =
                                error.status === 429 ? "http_429" : error.status === 503 ? "http_503" : "unexpected";
                            matched = !expected.cancelByClient && expected.status === error.status;
                        }
                    } finally {
                        if (timeout) clearTimeout(timeout);
                    }
                    outcomes[sampleId] = { durationMs: performance.now() - started, result, matched };
                }
            })
        );
        const elapsedMs = performance.now() - runStarted;
        await settleFixtureQueues(scheduler, fixtures);

        const statusCounts: Record<string, number> = {};
        for (const outcome of outcomes) statusCounts[outcome.result] = (statusCounts[outcome.result] ?? 0) + 1;
        const phase: Record<string, ReturnType<typeof summarizeLatencies>> = {};
        for (const phaseName of ["source.queue", "source.collect", "source.normalize", "http.queue", "http.request"]) {
            phase[phaseName] = summarizeLatencies(
                spans.filter((span) => span.phase === phaseName).map((span) => span.durationMs)
            );
        }
        const fixtureResults = fixtures.map((fixture) => fixture.snapshot());
        const passed =
            outcomes.every((outcome) => outcome.matched) &&
            sourceSuccess === (statusCounts.success ?? 0) &&
            sourceFailure === (statusCounts.http_429 ?? 0) + (statusCounts.http_503 ?? 0) &&
            !activeCollectors &&
            !activeHttp &&
            !scheduler.activeCount &&
            !scheduler.queuedCount;
        return {
            scenario,
            sourceConcurrency,
            requests: options.samples,
            clientConcurrency: options.clientConcurrency,
            latencyMs: summarizeLatencies(outcomes.map((outcome) => outcome.durationMs)),
            phasesMs: phase,
            elapsedMs: Math.round(elapsedMs),
            requestsPerSecond: Math.round((options.samples / (elapsedMs / 1000)) * 100) / 100,
            successfulRequests: statusCounts.success ?? 0,
            errorRequests: (statusCounts.http_429 ?? 0) + (statusCounts.http_503 ?? 0) + (statusCounts.unexpected ?? 0),
            cancelledRequests: statusCounts.cancelled ?? 0,
            responseStatuses: statusCounts,
            statusMismatchCount: outcomes.filter((outcome) => !outcome.matched).length,
            successRate: (statusCounts.success ?? 0) / options.samples,
            errorRate:
                ((statusCounts.http_429 ?? 0) + (statusCounts.http_503 ?? 0) + (statusCounts.unexpected ?? 0)) /
                options.samples,
            cancellationRate: (statusCounts.cancelled ?? 0) / options.samples,
            maxSourceActive,
            maxHttpActive,
            fixtureRequests: fixtureResults.reduce((sum, fixture) => sum + fixture.requests, 0),
            fixtureHttpStatuses: fixtureResults.reduce<Record<string, number>>((counts, fixture) => {
                for (const [status, count] of Object.entries(fixture.statuses)) {
                    counts[status] = (counts[status] ?? 0) + count;
                }
                return counts;
            }, {}),
            fixtureMaxConcurrentByOrigin: fixtureResults.map((fixture) => fixture.maxConcurrent),
            schedulerPendingAfterScenario: scheduler.queuedCount + scheduler.activeCount,
            cacheHitRate: null,
            backgroundCacheTasks: null,
            passed,
        };
    } finally {
        engine.close();
    }
}

export async function runHttpCollectionBenchmark(options: HttpCollectionBenchmarkOptions) {
    const fixtures = await startLoopbackFixtures(4);
    try {
        const scenarios = [];
        for (const scenario of options.scenarios) {
            for (const sourceConcurrency of options.sourceConcurrency) {
                const result = await runHttpCollectionScenario(scenario, sourceConcurrency, options, fixtures);
                scenarios.push(result);
                process.stdout.write(
                    scenario +
                        " sourceConcurrent=" +
                        sourceConcurrency +
                        " requests=" +
                        result.requests +
                        " p95=" +
                        result.latencyMs.p95 +
                        "ms statusMismatch=" +
                        result.statusMismatchCount +
                        " passed=" +
                        result.passed +
                        "\n"
                );
            }
        }
        const report = {
            formatVersion: 1,
            result: scenarios.every((scenario) => scenario.passed) ? "passed" : "failed",
            recordedAt: new Date().toISOString(),
            commit: readCommit(),
            environment: {
                node: process.version,
                platform: process.platform,
                architecture: process.arch,
                cpu: os.cpus()[0]?.model ?? "unknown",
                logicalCores: os.cpus().length,
                totalMemoryBytes: os.totalmem(),
            },
            workload: {
                samplesPerScenarioAndConfiguration: options.samples,
                clientConcurrency: options.clientConcurrency,
                sourceConcurrency: options.sourceConcurrency,
                seed: options.seed,
                scenarios: options.scenarios,
                fixtureOriginCount: fixtures.length,
                fixtureAddress: "127.0.0.1 on ephemeral local ports only",
                warmupRequestsPerOrigin: 5,
                sourceEngineQueue: { maxQueued: 100, queueTimeoutMs: 8000 },
                fetchScheduler: {
                    maxConcurrent: 8,
                    maxPerKey: 2,
                    maxQueued: 100,
                    queueTimeoutMs: 8000,
                    taskTimeoutMs: 8000,
                },
                fixtureErrors: "429/503 injected deterministically, no retries in this direct fetch harness",
                cache: "not exercised; this is NOT the Nitro API or SQLite cache baseline",
                smoke: options.smoke,
            },
            scenarios,
        };
        const path = resolve(options.output);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, JSON.stringify(report, null, 2) + "\n", "utf8");
        if (report.result !== "passed") throw new Error("Benchmark validation failed; see " + path);
        process.stdout.write("Benchmark passed. Report: " + path + "\n");
        return report;
    } finally {
        await Promise.all(fixtures.map((fixture) => fixture.close()));
    }
}

function printUsage() {
    process.stdout.write(
        [
            "Usage: pnpm performance:http-collection -- [options]",
            "  --samples N                >=1000 per scenario and source concurrency (default 1000)",
            "  --clients N                concurrent callers (default 30)",
            "  --source-concurrency 4,6,8 SourceEngine concurrency settings",
            "  --scenarios name,...       select a subset of the five fixture scenarios",
            "  --seed N                   deterministic fixture seed (default 20261123)",
            "  --output PATH              JSON report path",
            "  --smoke                    permit short non-comparable runs (<1000 samples)",
            "  --help                     show options",
        ].join("\n") + "\n"
    );
}

const invokedAsScript = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) {
    try {
        const options = parseHttpCollectionBenchmarkOptions(process.argv.slice(2));
        if (options.help) printUsage();
        else await runHttpCollectionBenchmark(options);
    } catch (error) {
        console.error(error);
        process.exitCode = 1;
    }
}
