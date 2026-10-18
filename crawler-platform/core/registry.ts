import { CrawlerPlatformError } from "./errors";
import { normalizeCrawlerItems } from "./output";
import { parseCrawlerPluginManifest } from "../sdk/manifest";

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
        const manifest = parseCrawlerPluginManifest(plugin.manifest);
        if (this.plugins.has(manifest.id)) {
            throw new CrawlerPlatformError("DUPLICATE_PLUGIN", `Plugin ${manifest.id} is already registered.`);
        }

        const keys = manifest.sources.map((source) => `${manifest.id}/${source.id}` as CrawlerSourceKey);
        const duplicateKey = keys.find((key) => this.sources.has(key));
        if (duplicateKey) {
            throw new CrawlerPlatformError("DUPLICATE_PLUGIN", `Source ${duplicateKey} is already registered.`);
        }

        this.plugins.set(manifest.id, plugin);
        manifest.sources.forEach((source, index) => {
            const key = keys[index];
            this.sources.set(key, { plugin, sourceId: source.id, key });
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

        const scopedContext = createScopedContext(registered.plugin, context);
        const result = await registered.plugin.collect(scopedContext, {
            sourceId: registered.sourceId,
            ...(parameters !== undefined ? { parameters } : {}),
        });

        if (context.signal.aborted) throw new CrawlerPlatformError("CANCELLED", `Collection for ${key} was cancelled.`);
        return normalizeCrawlerItems(result, { sourceKey: key });
    }
}

function createScopedContext(plugin: CrawlerPlugin, context: CrawlerContext): CrawlerContext {
    return {
        ...context,
        http: {
            request(request) {
                let origin: string;
                try {
                    origin = new URL(request.url).origin;
                } catch {
                    throw new CrawlerPlatformError("NETWORK_PERMISSION_DENIED", "Request URL is invalid.");
                }

                const method = request.method ?? "GET";
                const permitted = plugin.manifest.permissions.network.some(
                    (permission) => permission.origin === origin && permission.methods.includes(method)
                );
                if (!permitted) {
                    throw new CrawlerPlatformError(
                        "NETWORK_PERMISSION_DENIED",
                        `Plugin ${plugin.manifest.id} cannot request ${method} ${origin}.`
                    );
                }
                if (context.signal.aborted) {
                    throw new CrawlerPlatformError("CANCELLED", `Request for ${plugin.manifest.id} was cancelled.`);
                }

                return context.http.request(request);
            },
        },
    };
}
