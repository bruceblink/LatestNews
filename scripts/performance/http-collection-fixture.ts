import { type Server, createServer } from "node:http";

export const HTTP_BENCHMARK_SCENARIOS = [
    "fixed-spread",
    "jitter-spread",
    "single-origin",
    "http-errors",
    "client-cancel",
] as const;

export type HttpBenchmarkScenario = (typeof HTTP_BENCHMARK_SCENARIOS)[number];

export interface FixtureBehavior {
    delayMs: number;
    status: 200 | 429 | 503;
    cancelByClient: boolean;
}

export interface FixtureCounters {
    requests: number;
    completed: number;
    aborted: number;
    maxConcurrent: number;
    active: number;
    statuses: Record<string, number>;
}

export interface LoopbackFixture {
    origin: string;
    snapshot(): FixtureCounters;
    reset(): void;
    close(): Promise<void>;
}

export function fixtureBehavior(scenario: HttpBenchmarkScenario, sampleId: number, seed: number): FixtureBehavior {
    const value = (sampleId + seed) % 4294967296;
    switch (scenario) {
        case "fixed-spread":
        case "single-origin":
            return { delayMs: 16, status: 200, cancelByClient: false };
        case "jitter-spread":
            return {
                delayMs: 12 + (Math.abs(Math.imul(value + 2654435761, 2246822519)) % 49),
                status: 200,
                cancelByClient: false,
            };
        case "http-errors":
            return {
                delayMs: 14 + (value % 13),
                status: value % 17 === 0 ? 429 : value % 23 === 0 ? 503 : 200,
                cancelByClient: false,
            };
        case "client-cancel":
            return { delayMs: 64, status: 200, cancelByClient: value % 7 === 0 };
        default:
            throw new Error("Unsupported fixture scenario.");
    }
}

export function summarizeLatencies(values: readonly number[]) {
    if (!values.length) return { count: 0, p50: null, p95: null, p99: null };
    const sorted = [...values].sort((a, b) => a - b);
    const percentile = (p: number) => Math.round(sorted[Math.ceil(p * sorted.length) - 1]! * 100) / 100;
    return { count: sorted.length, p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99) };
}

export async function startLoopbackFixtures(count: number): Promise<LoopbackFixture[]> {
    if (!Number.isSafeInteger(count) || count < 1 || count > 8) {
        throw new RangeError("Fixture server count must be between 1 and 8.");
    }
    const fixtures: LoopbackFixture[] = [];
    try {
        for (let i = 0; i < count; i += 1) fixtures.push(await createFixture());
        return fixtures;
    } catch (error) {
        await Promise.all(fixtures.map((fixture) => fixture.close()));
        throw error;
    }
}

async function createFixture(): Promise<LoopbackFixture> {
    let requests = 0;
    let completed = 0;
    let aborted = 0;
    let active = 0;
    let maxConcurrent = 0;
    const statuses = new Map<number, number>();

    const server: Server = createServer((req, res) => {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        const scenario = url.searchParams.get("scenario");
        const sampleId = Number(url.searchParams.get("sampleId"));
        const seed = Number(url.searchParams.get("seed"));
        if (
            url.pathname !== "/feed" ||
            !HTTP_BENCHMARK_SCENARIOS.includes(scenario as HttpBenchmarkScenario) ||
            !Number.isSafeInteger(sampleId) ||
            sampleId < 0 ||
            !Number.isSafeInteger(seed) ||
            seed < 0
        ) {
            res.writeHead(400);
            res.end();
            return;
        }

        const behavior = fixtureBehavior(scenario as HttpBenchmarkScenario, sampleId, seed);
        requests += 1;
        active += 1;
        maxConcurrent = Math.max(maxConcurrent, active);
        let finished = false;
        const finish = () => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            active -= 1;
            if (!res.writableFinished) aborted += 1;
        };
        res.once("close", finish);
        const timer = setTimeout(() => {
            if (res.destroyed) return;
            res.writeHead(behavior.status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
            res.end(
                JSON.stringify({
                    id: "fixture-" + sampleId,
                    title: "Fixture headline " + sampleId,
                    url: "https://example.test/item/" + sampleId,
                })
            );
            completed += 1;
            statuses.set(behavior.status, (statuses.get(behavior.status) ?? 0) + 1);
        }, behavior.delayMs);
    });

    try {
        await new Promise<void>((resolve, reject) => {
            server.once("error", reject);
            server.listen(0, "127.0.0.1", () => {
                server.removeListener("error", reject);
                resolve();
            });
        });
    } catch (error) {
        server.close();
        throw error;
    }

    const address = server.address();
    if (typeof address === "string" || address === null) throw new Error("Loopback fixture address is unavailable.");
    return {
        origin: "http://127.0.0.1:" + address.port,
        snapshot() {
            return {
                requests,
                completed,
                aborted,
                active,
                maxConcurrent,
                statuses: Object.fromEntries([...statuses].map(([code, number]) => [String(code), number])),
            };
        },
        reset() {
            if (active) throw new Error("Fixture still has requests in flight.");
            requests = 0;
            completed = 0;
            aborted = 0;
            maxConcurrent = 0;
            statuses.clear();
        },
        close() {
            return new Promise<void>((resolve) => server.close(() => resolve()));
        },
    };
}
