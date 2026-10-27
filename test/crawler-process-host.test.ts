import { it, expect, describe } from "vitest";

import { ProcessCrawlerHost } from "../crawler-platform/host/process-host";
import { jsonExamplePlugin } from "../crawler-platform/examples/json/plugin";

import type { CrawlerContext, CrawlerHttpResponse } from "../crawler-platform/sdk/types";
import type {
    CrawlerWorkerCommand,
    CrawlerWorkerResponse,
    CrawlerProcessConnection,
} from "../crawler-platform/host/process-host";

describe("process crawler host", () => {
    it("preserves worker failure codes and cleans up when the worker cannot start", async () => {
        const connection = new FakeCrawlerConnection();
        const host = new ProcessCrawlerHost({
            target: "node",
            workerPath: "unused-worker.mjs",
            spawn: () => connection,
            timeoutMs: 1000,
            requestHandler: async () => ({ status: 200, headers: {}, body: "{}" }),
        });

        const failure = host.collect({
            manifest: jsonExamplePlugin.manifest,
            entryPath: "unused-plugin.mjs",
            sourceId: "latest",
            context: createContext(new AbortController().signal),
        });
        connection.emitMessage({ type: "failure", code: "SOURCE_NOT_FOUND", message: "unknown source" });
        await expect(failure).rejects.toMatchObject({ code: "SOURCE_NOT_FOUND", message: "unknown source" });

        const failedConnection = new FakeCrawlerConnection(new Error("worker disconnected"));
        const failedHost = new ProcessCrawlerHost({
            target: "node",
            workerPath: "unused-worker.mjs",
            spawn: () => failedConnection,
            timeoutMs: 1000,
            requestHandler: async () => ({ status: 200, headers: {}, body: "{}" }),
        });
        await expect(
            failedHost.collect({
                manifest: jsonExamplePlugin.manifest,
                entryPath: "unused-plugin.mjs",
                sourceId: "latest",
                context: createContext(new AbortController().signal),
            })
        ).rejects.toMatchObject({ code: "WORKER_EXIT" });
        await delay(5);
        expect(failedConnection.killCount).toBe(0);
    });

    it("enforces manifest request and response budgets at the network broker", async () => {
        const connection = new FakeCrawlerConnection();
        let requestCount = 0;
        const host = new ProcessCrawlerHost({
            target: "node",
            workerPath: "unused-worker.mjs",
            spawn: () => connection,
            timeoutMs: 1000,
            requestHandler: async () => {
                requestCount += 1;
                return { status: 200, headers: {}, body: "{}" };
            },
        });
        const manifest = {
            ...jsonExamplePlugin.manifest,
            id: "org.latestnews.example-budget",
            limits: {
                ...jsonExamplePlugin.manifest.limits,
                maxRequestsPerRun: 1,
                maxRequestBodyBytes: 2,
            },
        };

        const collection = host.collect({
            manifest,
            entryPath: "unused-plugin.mjs",
            sourceId: "latest",
            context: createContext(new AbortController().signal),
        });
        connection.emitMessage({
            type: "http-request",
            requestId: 1,
            request: { url: "https://json.example.test/news.json" },
        });
        await delay(0);
        expect(requestCount).toBe(1);
        expect(connection.sentMessages).toContainEqual({
            type: "http-response",
            requestId: 1,
            response: { status: 200, headers: {}, body: "{}" },
        });

        connection.emitMessage({
            type: "http-request",
            requestId: 2,
            request: { url: "https://json.example.test/news.json" },
        });
        await delay(0);
        expect(requestCount).toBe(1);
        expect(connection.sentMessages).toContainEqual(
            expect.objectContaining({ type: "http-error", requestId: 2, code: "RESOURCE_LIMIT" })
        );

        connection.emitMessage({ type: "result", items: [] });
        await expect(collection).resolves.toEqual([]);
    });

    it("rejects oversized request bodies before invoking the network handler", async () => {
        const connection = new FakeCrawlerConnection();
        let requestCount = 0;
        const host = new ProcessCrawlerHost({
            target: "node",
            workerPath: "unused-worker.mjs",
            spawn: () => connection,
            timeoutMs: 1000,
            requestHandler: async () => {
                requestCount += 1;
                return { status: 200, headers: {}, body: "{}" };
            },
        });
        const manifest = {
            ...jsonExamplePlugin.manifest,
            id: "org.latestnews.example-body-budget",
            permissions: {
                network: [
                    {
                        origin: "https://json.example.test",
                        methods: ["GET", "POST"] as ("GET" | "POST")[],
                    },
                ],
            },
            limits: {
                ...jsonExamplePlugin.manifest.limits,
                maxRequestBodyBytes: 2,
            },
        };

        const collection = host.collect({
            manifest,
            entryPath: "unused-plugin.mjs",
            sourceId: "latest",
            context: createContext(new AbortController().signal),
        });
        connection.emitMessage({
            type: "http-request",
            requestId: 1,
            request: { url: "https://json.example.test/news.json", method: "POST", body: "too large" },
        });
        await delay(0);

        expect(requestCount).toBe(0);
        expect(connection.sentMessages).toContainEqual(
            expect.objectContaining({ type: "http-error", requestId: 1, code: "RESOURCE_LIMIT" })
        );
        connection.emitMessage({ type: "result", items: [] });
        await expect(collection).resolves.toEqual([]);
    });

    it("blocks credential headers and oversized response headers at the broker", async () => {
        const connection = new FakeCrawlerConnection();
        let requestCount = 0;
        const host = new ProcessCrawlerHost({
            target: "node",
            workerPath: "unused-worker.mjs",
            spawn: () => connection,
            timeoutMs: 1000,
            requestHandler: async () => {
                requestCount += 1;
                return { status: 200, headers: { "x-large": "x".repeat(2048) }, body: "{}" };
            },
        });
        const manifest = {
            ...jsonExamplePlugin.manifest,
            id: "org.latestnews.example-header-budget",
            limits: {
                ...jsonExamplePlugin.manifest.limits,
                maxResponseHeadersBytes: 1024,
            },
        };
        const collection = host.collect({
            manifest,
            entryPath: "unused-plugin.mjs",
            sourceId: "latest",
            context: createContext(new AbortController().signal),
        });

        connection.emitMessage({
            type: "http-request",
            requestId: 1,
            request: { url: "https://json.example.test/news.json", headers: { Cookie: "session=secret" } },
        });
        await delay(0);
        expect(requestCount).toBe(0);
        expect(connection.sentMessages).toContainEqual(
            expect.objectContaining({ type: "http-error", requestId: 1, code: "NETWORK_PERMISSION_DENIED" })
        );

        connection.emitMessage({
            type: "http-request",
            requestId: 2,
            request: { url: "https://json.example.test/news.json" },
        });
        await delay(0);
        expect(requestCount).toBe(1);
        expect(connection.sentMessages).toContainEqual(
            expect.objectContaining({ type: "http-error", requestId: 2, code: "RESOURCE_LIMIT" })
        );

        connection.emitMessage({ type: "result", items: [] });
        await expect(collection).resolves.toEqual([]);
    });

    it("caps cumulative response bytes across one run", async () => {
        const connection = new FakeCrawlerConnection();
        let requestCount = 0;
        const host = new ProcessCrawlerHost({
            target: "node",
            workerPath: "unused-worker.mjs",
            spawn: () => connection,
            timeoutMs: 1000,
            requestHandler: async () => {
                requestCount += 1;
                return { status: 200, headers: {}, body: "x".repeat(requestCount < 3 ? 1024 : 1) };
            },
        });
        const manifest = {
            ...jsonExamplePlugin.manifest,
            id: "org.latestnews.example-response-budget",
            limits: {
                ...jsonExamplePlugin.manifest.limits,
                maxRequestsPerRun: 3,
                maxResponseBytes: 1024,
                maxResponseBytesPerRun: 2048,
            },
        };

        const collection = host.collect({
            manifest,
            entryPath: "unused-plugin.mjs",
            sourceId: "latest",
            context: createContext(new AbortController().signal),
        });
        for (const requestId of [1, 2, 3]) {
            connection.emitMessage({
                type: "http-request",
                requestId,
                request: { url: "https://json.example.test/news.json" },
            });
            await delay(0);
        }

        expect(requestCount).toBe(3);
        expect(connection.sentMessages).toContainEqual(
            expect.objectContaining({ type: "http-error", requestId: 3, code: "RESOURCE_LIMIT" })
        );
        connection.emitMessage({ type: "result", items: [] });
        await expect(collection).resolves.toEqual([]);
    });

    it("aborts pending HTTP work and terminates a worker that ignores cancellation", async () => {
        const connection = new FakeCrawlerConnection();
        const contextController = new AbortController();
        let requestSignal: AbortSignal | undefined;
        let resolveResponse: (response: CrawlerHttpResponse) => void = () => undefined;
        const pendingResponse = new Promise<CrawlerHttpResponse>((resolve) => {
            resolveResponse = resolve;
        });
        const host = new ProcessCrawlerHost({
            target: "node",
            workerPath: "unused-worker.mjs",
            spawn: () => connection,
            timeoutMs: 1000,
            cancelGraceMs: 20,
            requestHandler: async (_request, signal) => {
                requestSignal = signal;
                return pendingResponse;
            },
        });

        const collection = host.collect({
            manifest: jsonExamplePlugin.manifest,
            entryPath: "unused-plugin.mjs",
            sourceId: "latest",
            context: createContext(contextController.signal),
        });
        connection.emitMessage({
            type: "http-request",
            requestId: 1,
            request: { url: "https://json.example.test/news.json" },
        });
        contextController.abort();

        await expect(collection).rejects.toMatchObject({ code: "CANCELLED" });
        expect(requestSignal?.aborted).toBe(true);
        expect(connection.sentMessages).toContainEqual({ type: "cancel" });

        resolveResponse({ status: 200, headers: {}, body: "{}" });
        await delay(5);
        expect(connection.sentMessages.some((message) => message.type === "http-response")).toBe(false);
        expect(connection.sentMessages.some((message) => message.type === "http-error")).toBe(false);

        await delay(30);
        expect(connection.killCount).toBe(1);
    });

    it("rejects active collections immediately when the host is disposed", async () => {
        const connection = new FakeCrawlerConnection();
        let requestSignal: AbortSignal | undefined;
        const pendingResponse = new Promise<CrawlerHttpResponse>(() => undefined);
        const host = new ProcessCrawlerHost({
            target: "node",
            workerPath: "unused-worker.mjs",
            spawn: () => connection,
            timeoutMs: 1000,
            requestHandler: async (_request, signal) => {
                requestSignal = signal;
                return pendingResponse;
            },
        });
        const collection = host.collect({
            manifest: jsonExamplePlugin.manifest,
            entryPath: "unused-plugin.mjs",
            sourceId: "latest",
            context: createContext(new AbortController().signal),
        });
        connection.emitMessage({
            type: "http-request",
            requestId: 1,
            request: { url: "https://json.example.test/news.json" },
        });
        await delay(0);

        host.dispose();
        await expect(collection).rejects.toMatchObject({ code: "CANCELLED" });
        expect(requestSignal?.aborted).toBe(true);
        expect(connection.killCount).toBe(1);
    });
});

class FakeCrawlerConnection implements CrawlerProcessConnection {
    readonly sentMessages: CrawlerWorkerCommand[] = [];
    killCount = 0;
    constructor(private readonly sendFailure?: Error) {}
    private readonly messageHandlers = new Set<(message: CrawlerWorkerResponse) => void>();
    private readonly exitHandlers = new Set<(code: number | null, signal: string | null) => void>();

    send(message: CrawlerWorkerCommand) {
        if (this.sendFailure) throw this.sendFailure;
        this.sentMessages.push(message);
    }

    onMessage(handler: (message: CrawlerWorkerResponse) => void) {
        this.messageHandlers.add(handler);
        return () => this.messageHandlers.delete(handler);
    }

    onExit(handler: (code: number | null, signal: string | null) => void) {
        this.exitHandlers.add(handler);
        return () => this.exitHandlers.delete(handler);
    }

    kill() {
        this.killCount += 1;
    }

    emitMessage(message: CrawlerWorkerResponse) {
        for (const handler of this.messageHandlers) handler(message);
    }
}

function createContext(signal: AbortSignal): CrawlerContext {
    return {
        signal,
        now: () => Date.UTC(2026, 9, 18),
        http: {
            request: async () => {
                throw new Error("The process host test must broker the HTTP request.");
            },
        },
    };
}

function delay(milliseconds: number) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
