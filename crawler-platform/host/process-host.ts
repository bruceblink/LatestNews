import { utf8ByteLength } from "../sdk/limits";
import { CrawlerPlatformError } from "../core/errors";
import { normalizeCrawlerItems } from "../core/output";
import { parseCrawlerPluginManifest } from "../sdk/manifest";
import { assertCrawlerNetworkPermission } from "../sdk/network";

import type { CrawlerPluginManifest } from "../sdk/manifest";
import type { CrawlerItem, CrawlerTarget, CrawlerContext, CrawlerHttpRequest, CrawlerHttpResponse } from "../sdk/types";

export type CrawlerWorkerResponse =
    | { type: "http-request"; requestId: number; request: CrawlerHttpRequest }
    | { type: "result"; items: unknown }
    | { type: "failure"; code?: string; message: string };

interface StartMessage {
    type: "start";
    entryPath: string;
    pluginId: string;
    pluginVersion: string;
    sourceId: string;
    parameters?: unknown;
    now: number;
}

export interface CrawlerProcessConnection {
    send(message: StartMessage | { type: "cancel" } | HttpReply): void;
    onMessage(handler: (message: CrawlerWorkerResponse) => void): () => void;
    onExit(handler: (code: number | null, signal: string | null) => void): () => void;
    kill(): void;
}

type HttpReply =
    | { type: "http-response"; requestId: number; response: CrawlerHttpResponse }
    | { type: "http-error"; requestId: number; message: string; code: string };

export type CrawlerWorkerCommand = StartMessage | { type: "cancel" } | HttpReply;

export interface ProcessCrawlerHostOptions {
    workerPath: string;
    target: CrawlerTarget;
    spawn(): CrawlerProcessConnection;
    requestHandler(request: CrawlerHttpRequest, signal: AbortSignal): Promise<CrawlerHttpResponse>;
    timeoutMs?: number;
    maxResponseBytes?: number;
    cancelGraceMs?: number;
}

export interface ProcessCrawlerCollection {
    manifest: CrawlerPluginManifest;
    entryPath: string;
    sourceId: string;
    context: CrawlerContext;
    parameters?: unknown;
}

/** Execute a trusted plugin in a short-lived child process and broker its network calls. */
export class ProcessCrawlerHost {
    private readonly connections = new Set<CrawlerProcessConnection>();
    private closed = false;

    constructor(private readonly options: ProcessCrawlerHostOptions) {}

    /** Stop active workers when the owning application is closing. */
    dispose() {
        if (this.closed) return;
        this.closed = true;
        for (const connection of this.connections) connection.kill();
        this.connections.clear();
    }

    collect({ manifest: inputManifest, entryPath, sourceId, context, parameters }: ProcessCrawlerCollection) {
        const manifest = parseCrawlerPluginManifest(inputManifest);
        if (!manifest.targets.includes(this.options.target)) {
            throw new CrawlerPlatformError(
                "TARGET_UNSUPPORTED",
                `Plugin ${manifest.id} does not support the ${this.options.target} host.`
            );
        }
        if (!manifest.sources.some((source) => source.id === sourceId)) {
            throw new CrawlerPlatformError("SOURCE_NOT_FOUND", `Plugin ${manifest.id} does not declare ${sourceId}.`);
        }
        if (this.closed) {
            return Promise.reject(new CrawlerPlatformError("CANCELLED", "Crawler host is closed."));
        }

        const sourceKey = `${manifest.id}/${sourceId}` as const;
        const connection = this.options.spawn();
        this.connections.add(connection);
        const timeoutMs = Math.min(
            this.options.timeoutMs ?? manifest.limits.maxExecutionMs,
            manifest.limits.maxExecutionMs
        );
        const maxResponseBytes = Math.min(
            this.options.maxResponseBytes ?? manifest.limits.maxResponseBytes,
            manifest.limits.maxResponseBytes
        );
        const cancelGraceMs = this.options.cancelGraceMs ?? 150;
        const usage = { requestCount: 0, responseBytes: 0 };

        return new Promise<CrawlerItem[]>((resolve, reject) => {
            let settled = false;
            const requestController = new AbortController();
            const timeout = setTimeout(() => {
                connection.kill();
                finish(new CrawlerPlatformError("TIMEOUT", `Plugin ${manifest.id} exceeded ${timeoutMs} ms.`));
            }, timeoutMs);

            const cleanup = () => {
                clearTimeout(timeout);
                context.signal.removeEventListener("abort", abort);
                if (!requestController.signal.aborted) requestController.abort();
                removeMessageListener();
                removeExitListener();
                this.connections.delete(connection);
            };

            const finish = (error?: unknown, items?: CrawlerItem[]) => {
                if (settled) return;
                settled = true;
                cleanup();
                if (error) reject(error);
                else resolve(items ?? []);
            };

            const abort = () => {
                try {
                    connection.send({ type: "cancel" });
                } catch {
                    // The worker may have exited while the host was processing the abort.
                }
                setTimeout(() => connection.kill(), cancelGraceMs);
                finish(new CrawlerPlatformError("CANCELLED", `Collection for ${sourceKey} was cancelled.`));
            };

            const removeMessageListener = connection.onMessage((message) => {
                if (settled) return;
                if (message.type === "http-request") {
                    void this.handleHttpRequest({
                        request: message.request,
                        requestId: message.requestId,
                        connection,
                        manifest,
                        signal: requestController.signal,
                        maxResponseBytes,
                        usage,
                    }).catch((error: unknown) => {
                        if (!settled) {
                            finish(
                                new CrawlerPlatformError("WORKER_EXIT", "Plugin worker stopped accepting messages.", {
                                    cause: error,
                                })
                            );
                        }
                    });
                    return;
                }
                if (message.type === "result") {
                    try {
                        finish(
                            undefined,
                            normalizeCrawlerItems(message.items, {
                                sourceKey,
                                maxItems: manifest.limits.maxItems,
                                maxBytes: manifest.limits.maxOutputBytes,
                            })
                        );
                    } catch (error) {
                        connection.kill();
                        finish(error);
                    }
                    return;
                }
                finish(new CrawlerPlatformError("INVALID_PLUGIN", message.message));
            });

            const removeExitListener = connection.onExit((code, signal) => {
                if (!settled) {
                    finish(
                        new CrawlerPlatformError(
                            this.closed ? "CANCELLED" : "WORKER_EXIT",
                            this.closed
                                ? `Collection for ${sourceKey} was cancelled because the crawler host is closing.`
                                : `Plugin ${manifest.id} exited before returning results (code ${code ?? "unknown"}, signal ${signal ?? "none"}).`
                        )
                    );
                }
            });

            context.signal.addEventListener("abort", abort, { once: true });
            if (context.signal.aborted) {
                abort();
                return;
            }

            connection.send({
                type: "start",
                entryPath,
                pluginId: manifest.id,
                pluginVersion: manifest.version,
                sourceId,
                ...(parameters !== undefined ? { parameters } : {}),
                now: context.now(),
            });
        });
    }

    private async handleHttpRequest({
        request,
        requestId,
        connection,
        manifest,
        signal,
        maxResponseBytes,
        usage,
    }: {
        request: CrawlerHttpRequest;
        requestId: number;
        connection: CrawlerProcessConnection;
        manifest: CrawlerPluginManifest;
        signal: AbortSignal;
        maxResponseBytes: number;
        usage: { requestCount: number; responseBytes: number };
    }) {
        try {
            assertCrawlerNetworkPermission(manifest.permissions.network, request);
            const requestBodyBytes = request.body === undefined ? 0 : utf8ByteLength(request.body);
            if (requestBodyBytes > manifest.limits.maxRequestBodyBytes) {
                throw new CrawlerPlatformError(
                    "RESOURCE_LIMIT",
                    `Request body exceeds ${manifest.limits.maxRequestBodyBytes} bytes.`
                );
            }
            if (usage.requestCount >= manifest.limits.maxRequestsPerRun) {
                throw new CrawlerPlatformError(
                    "RESOURCE_LIMIT",
                    `Plugin ${manifest.id} exceeded ${manifest.limits.maxRequestsPerRun} requests per run.`
                );
            }
            usage.requestCount += 1;
            const response = await this.options.requestHandler(request, signal);
            if (signal.aborted) return;
            const byteLength = utf8ByteLength(response.body);
            if (byteLength > maxResponseBytes) {
                throw new CrawlerPlatformError("RESOURCE_LIMIT", `Response exceeds ${maxResponseBytes} bytes.`);
            }
            if (usage.responseBytes + byteLength > manifest.limits.maxResponseBytesPerRun) {
                throw new CrawlerPlatformError(
                    "RESOURCE_LIMIT",
                    `Plugin response data exceeds ${manifest.limits.maxResponseBytesPerRun} bytes per run.`
                );
            }
            usage.responseBytes += byteLength;
            connection.send({ type: "http-response", requestId, response });
        } catch (error) {
            if (signal.aborted) return;
            const failure = error instanceof CrawlerPlatformError ? error : undefined;
            connection.send({
                type: "http-error",
                requestId,
                code: failure?.code ?? "HTTP_FAILED",
                message: error instanceof Error ? error.message : "HTTP request failed.",
            });
        }
    }
}
