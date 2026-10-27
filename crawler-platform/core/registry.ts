import { utf8ByteLength } from "../sdk/limits";
import { CrawlerPlatformError } from "./errors";
import { normalizeCrawlerItems } from "./output";
import { parseCrawlerPluginManifest, freezeCrawlerPluginManifest } from "../sdk/manifest";
import { assertCrawlerHttpResponse, assertCrawlerNetworkPermission } from "../sdk/network";

import type { CrawlerPlugin, CrawlerContext, CrawlerSourceKey, CrawlerSourceDescriptor } from "../sdk/types";

interface RegisteredSource {
    plugin: CrawlerPlugin;
    sourceId: string;
    key: CrawlerSourceKey;
}

/** Resolve plugin-owned source keys without importing application metadata or framework code. */
export class CrawlerPluginRegistry {
    private readonly plugins = new Map<string, CrawlerPlugin>();
    private readonly sources = new Map<CrawlerSourceKey, RegisteredSource>();

    register(plugin: CrawlerPlugin): void {
        const manifest = freezeCrawlerPluginManifest(parseCrawlerPluginManifest(plugin.manifest));
        if (this.plugins.has(manifest.id)) {
            throw new CrawlerPlatformError("DUPLICATE_PLUGIN", `Plugin ${manifest.id} is already registered.`);
        }

        const keys = manifest.sources.map((source) => `${manifest.id}/${source.id}` as CrawlerSourceKey);
        const duplicateKey = keys.find((key) => this.sources.has(key));
        if (duplicateKey) {
            throw new CrawlerPlatformError("DUPLICATE_PLUGIN", `Source ${duplicateKey} is already registered.`);
        }

        const normalizedPlugin = Object.freeze({ ...plugin, manifest });
        this.plugins.set(manifest.id, normalizedPlugin);
        manifest.sources.forEach((source, index) => {
            const key = keys[index];
            this.sources.set(key, { plugin: normalizedPlugin, sourceId: source.id, key });
        });
    }

    listSources(): CrawlerSourceDescriptor[] {
        return [...this.sources.values()].map(({ plugin, sourceId, key }) => {
            const source = plugin.manifest.sources.find((candidate) => candidate.id === sourceId);
            if (!source) throw new CrawlerPlatformError("SOURCE_NOT_FOUND", `Source ${key} is not registered.`);

            return {
                key,
                pluginId: plugin.manifest.id,
                pluginVersion: plugin.manifest.version,
                id: source.id,
                name: source.name,
                kind: source.kind,
                refreshIntervalSeconds: source.refreshIntervalSeconds,
                targets: plugin.manifest.targets,
            };
        });
    }

    async collect(key: CrawlerSourceKey, context: CrawlerContext, parameters?: unknown) {
        const registered = this.sources.get(key);
        if (!registered) throw new CrawlerPlatformError("SOURCE_NOT_FOUND", `Source ${key} is not registered.`);
        if (context.signal.aborted) throw new CrawlerPlatformError("CANCELLED", `Collection for ${key} was cancelled.`);

        const executionController = new AbortController();
        const limits = registered.plugin.manifest.limits;
        let timedOut = false;
        let timeout: ReturnType<typeof setTimeout> | undefined;
        let removeCancellationListener: () => void = () => undefined;
        const cancellation = new Promise<never>((_, reject) => {
            const onAbort = () => {
                executionController.abort();
                reject(new CrawlerPlatformError("CANCELLED", `Collection for ${key} was cancelled.`));
            };
            removeCancellationListener = () => context.signal.removeEventListener("abort", onAbort);
            context.signal.addEventListener("abort", onAbort, { once: true });
            if (context.signal.aborted) onAbort();
        });
        const deadline = new Promise<never>((_, reject) => {
            timeout = setTimeout(() => {
                timedOut = true;
                executionController.abort();
                reject(
                    new CrawlerPlatformError(
                        "TIMEOUT",
                        `Plugin ${registered.plugin.manifest.id} exceeded ${limits.maxExecutionMs} ms.`
                    )
                );
            }, limits.maxExecutionMs);
        });

        try {
            const scopedContext = createScopedContext(registered.plugin, context, executionController.signal);
            let result: unknown;
            try {
                result = await Promise.race([
                    registered.plugin.collect(scopedContext, {
                        sourceId: registered.sourceId,
                        ...(parameters !== undefined ? { parameters } : {}),
                    }),
                    cancellation,
                    deadline,
                ]);
            } catch (error) {
                if (timedOut) {
                    throw new CrawlerPlatformError(
                        "TIMEOUT",
                        `Plugin ${registered.plugin.manifest.id} exceeded ${limits.maxExecutionMs} ms.`
                    );
                }
                if (context.signal.aborted) {
                    throw new CrawlerPlatformError("CANCELLED", `Collection for ${key} was cancelled.`);
                }
                throw error;
            }

            if (context.signal.aborted) {
                throw new CrawlerPlatformError("CANCELLED", `Collection for ${key} was cancelled.`);
            }
            if (timedOut) {
                throw new CrawlerPlatformError(
                    "TIMEOUT",
                    `Plugin ${registered.plugin.manifest.id} exceeded ${limits.maxExecutionMs} ms.`
                );
            }
            return normalizeCrawlerItems(result, {
                sourceKey: key,
                maxItems: limits.maxItems,
                maxBytes: limits.maxOutputBytes,
            });
        } finally {
            if (timeout) clearTimeout(timeout);
            removeCancellationListener();
            executionController.abort();
        }
    }
}

function createScopedContext(plugin: CrawlerPlugin, context: CrawlerContext, signal: AbortSignal): CrawlerContext {
    const usage = { requestCount: 0, responseBytes: 0 };
    return {
        ...context,
        signal,
        http: {
            request(request) {
                assertCrawlerNetworkPermission(
                    plugin.manifest.permissions.network,
                    request,
                    plugin.manifest.limits.maxRequestHeadersBytes
                );
                if (signal.aborted) {
                    throw new CrawlerPlatformError("CANCELLED", `Request for ${plugin.manifest.id} was cancelled.`);
                }
                const requestBodyBytes = request.body === undefined ? 0 : utf8ByteLength(request.body);
                if (requestBodyBytes > plugin.manifest.limits.maxRequestBodyBytes) {
                    throw new CrawlerPlatformError(
                        "RESOURCE_LIMIT",
                        `Request body exceeds ${plugin.manifest.limits.maxRequestBodyBytes} bytes.`
                    );
                }
                if (usage.requestCount >= plugin.manifest.limits.maxRequestsPerRun) {
                    throw new CrawlerPlatformError(
                        "RESOURCE_LIMIT",
                        `Plugin ${plugin.manifest.id} exceeded ${plugin.manifest.limits.maxRequestsPerRun} requests per run.`
                    );
                }
                usage.requestCount += 1;

                return context.http.request(request).then((response) => {
                    if (signal.aborted) {
                        throw new CrawlerPlatformError("CANCELLED", `Request for ${plugin.manifest.id} was cancelled.`);
                    }
                    assertCrawlerHttpResponse(response, {
                        maxBodyBytes: plugin.manifest.limits.maxResponseBytes,
                        maxHeaderBytes: plugin.manifest.limits.maxResponseHeadersBytes,
                    });
                    const responseBytes = utf8ByteLength(response.body);
                    if (usage.responseBytes + responseBytes > plugin.manifest.limits.maxResponseBytesPerRun) {
                        throw new CrawlerPlatformError(
                            "RESOURCE_LIMIT",
                            `Plugin response data exceeds ${plugin.manifest.limits.maxResponseBytesPerRun} bytes per run.`
                        );
                    }
                    usage.responseBytes += responseBytes;
                    return response;
                });
            },
        },
    };
}
