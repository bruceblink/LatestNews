import { sep, resolve, relative, isAbsolute } from "node:path";
import { statSync, existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";

import { CrawlerPlatformError } from "../core/errors";
import { createCrawlerTaskQueue } from "./task-queue";
import { parseCrawlerPluginManifest } from "../sdk/manifest";
import { createDynamicSourceId } from "../../shared/dynamic-source-id";

import type { CrawlerPluginManifest } from "../sdk/manifest";
import type { CrawlerItem, CrawlerTarget, CrawlerContext, CrawlerHttpResponse } from "../sdk/types";

const MAX_PLUGIN_DIRECTORIES = 256;

interface InstalledPluginSource {
    manifest: CrawlerPluginManifest;
    entryPath: string;
    channelId: string;
    name: string;
    interval: number;
    type?: "hottest" | "realtime";
    column?: "china" | "world" | "tech" | "finance";
    title?: string;
    desc?: string;
    home?: string;
}

export interface CrawlerPluginSourceInfo {
    id: string;
    pluginId: string;
    pluginVersion: string;
    name: string;
    interval: number;
    type?: "hottest" | "realtime";
    column?: "china" | "world" | "tech" | "finance";
    title?: string;
    desc?: string;
    home?: string;
}

export interface CrawlerPluginExecutionHost {
    collect(request: {
        manifest: CrawlerPluginManifest;
        entryPath: string;
        sourceId: string;
        context: CrawlerContext;
    }): Promise<CrawlerItem[]>;
}

export interface CrawlerPluginProviderOptions {
    pluginDirectory: string;
    enabledPluginIds: readonly string[];
    acceptedSourceIds: ReadonlySet<string>;
    target: CrawlerTarget;
    workerPath: string;
    createHost(): CrawlerPluginExecutionHost;
    maxConcurrent?: number;
    maxQueued?: number;
    queueTimeoutMs?: number;
}

/** Load only enabled bundles, validate their source IDs, and bound execution across a host. */
export function createCrawlerPluginProvider(options: CrawlerPluginProviderOptions) {
    const enabledIds = new Set(options.enabledPluginIds.map((id) => id.trim()).filter(Boolean));
    if (enabledIds.size !== options.enabledPluginIds.filter((id) => id.trim()).length) {
        throw new Error("Enabled plugin IDs must be nonempty and unique.");
    }

    const sources = loadPluginSources(options, enabledIds);
    const queue = createCrawlerTaskQueue({
        maxConcurrent: options.maxConcurrent ?? 4,
        maxQueued: options.maxQueued ?? 64,
        queueTimeoutMs: options.queueTimeoutMs ?? 30000,
    });
    let host: CrawlerPluginExecutionHost | undefined;

    return {
        hasSource(sourceId: string) {
            return sources.has(sourceId);
        },
        listSourceIds() {
            return [...sources.keys()];
        },
        listSources(): CrawlerPluginSourceInfo[] {
            return [...sources.entries()].map(([id, source]) => ({
                id,
                pluginId: source.manifest.id,
                pluginVersion: source.manifest.version,
                name: source.name,
                interval: source.interval,
                ...(source.type ? { type: source.type } : {}),
                ...(source.column ? { column: source.column } : {}),
                ...(source.title ? { title: source.title } : {}),
                ...(source.desc ? { desc: source.desc } : {}),
                ...(source.home ? { home: source.home } : {}),
            }));
        },
        async collect(sourceId: string) {
            const source = sources.get(sourceId);
            if (!source) return undefined;
            host ??= options.createHost();
            const context = createProviderContext();
            return queue.run(() =>
                host!.collect({
                    manifest: source.manifest,
                    entryPath: source.entryPath,
                    sourceId: source.channelId,
                    context,
                })
            );
        },
    };
}

function loadPluginSources(options: CrawlerPluginProviderOptions, enabledIds: ReadonlySet<string>) {
    if (enabledIds.size === 0) return new Map<string, InstalledPluginSource>();
    if (!existsSync(options.pluginDirectory)) {
        throw new Error(
            `Enabled crawler plugins are configured, but the directory does not exist: ${options.pluginDirectory}`
        );
    }

    const pluginRoot = realpathSync(options.pluginDirectory);
    const candidates = readdirSync(pluginRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && enabledIds.has(entry.name))
        .sort((left, right) => left.name.localeCompare(right.name));
    if (candidates.length > MAX_PLUGIN_DIRECTORIES) {
        throw new Error(`Crawler plugin directory exceeds the ${MAX_PLUGIN_DIRECTORIES}-package limit.`);
    }

    const foundPluginIds = new Set<string>();
    const sources = new Map<string, InstalledPluginSource>();
    for (const candidate of candidates) {
        const packageRoot = realpathSync(resolve(pluginRoot, candidate.name));
        const manifestPath = resolvePluginFile(pluginRoot, packageRoot, "manifest.json");
        const manifest = parseCrawlerPluginManifest(JSON.parse(readFileSync(manifestPath, "utf8")) as unknown);
        if (!enabledIds.has(manifest.id)) continue;
        if (candidate.name !== manifest.id) {
            throw new Error(`Crawler plugin directory ${candidate.name} must match manifest ID ${manifest.id}.`);
        }
        if (!manifest.targets.includes(options.target)) {
            throw new CrawlerPlatformError(
                "TARGET_UNSUPPORTED",
                `Plugin ${manifest.id} does not support the ${options.target} host.`
            );
        }
        foundPluginIds.add(manifest.id);

        const entryPath = resolvePluginFile(packageRoot, packageRoot, manifest.entry);
        if (!statSync(entryPath).isFile()) {
            throw new CrawlerPlatformError("INVALID_MANIFEST", `Plugin entry ${manifest.entry} is not a file.`);
        }
        for (const source of manifest.sources) {
            const sourceId = options.acceptedSourceIds.has(source.id)
                ? source.id
                : createDynamicSourceId(manifest.id, source.id);
            if (sourceId !== source.id && options.acceptedSourceIds.has(sourceId)) {
                throw new CrawlerPlatformError(
                    "DUPLICATE_PLUGIN",
                    `Dynamic source ${sourceId} conflicts with an application source.`
                );
            }
            if (sources.has(sourceId)) {
                throw new CrawlerPlatformError(
                    "DUPLICATE_PLUGIN",
                    `More than one enabled plugin declares ${sourceId}.`
                );
            }
            sources.set(sourceId, {
                manifest,
                entryPath,
                channelId: source.id,
                name: source.name,
                interval: source.refreshIntervalSeconds * 1000,
                ...(source.kind !== "timeline" ? { type: source.kind } : {}),
                ...(source.column ? { column: source.column } : {}),
                ...(source.title ? { title: source.title } : {}),
                ...(source.description ? { desc: source.description } : {}),
                ...(source.home ? { home: source.home } : {}),
            });
        }
    }

    const missingIds = [...enabledIds].filter((id) => !foundPluginIds.has(id));
    if (missingIds.length > 0) {
        throw new Error(`Enabled crawler plugins were not found: ${missingIds.join(", ")}.`);
    }

    const workerPath = realpathSync(options.workerPath);
    if (!statSync(workerPath).isFile()) throw new Error(`Crawler worker entry is not a file: ${workerPath}`);
    return sources;
}

function resolvePluginFile(pluginRoot: string, packageRoot: string, relativePath: string) {
    if (
        !relativePath ||
        isAbsolute(relativePath) ||
        relativePath.includes("\\") ||
        relativePath.includes(":") ||
        relativePath.includes("\0") ||
        relativePath.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
    ) {
        throw new CrawlerPlatformError("INVALID_MANIFEST", `Unsafe plugin path ${relativePath}.`);
    }
    const resolvedPath = realpathSync(resolve(packageRoot, ...relativePath.split("/")));
    assertPathWithin(pluginRoot, resolvedPath);
    return resolvedPath;
}

function assertPathWithin(root: string, candidate: string) {
    const pathFromRoot = relative(root, candidate);
    if (!pathFromRoot || pathFromRoot === ".." || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot)) {
        throw new CrawlerPlatformError("INVALID_MANIFEST", `Resolved plugin file escapes its package: ${candidate}`);
    }
}

function createProviderContext(): CrawlerContext {
    return {
        signal: new AbortController().signal,
        now: Date.now,
        http: {
            request: async (): Promise<CrawlerHttpResponse> => {
                throw new Error("Plugin network requests must use the host's permission-checked HTTP broker.");
            },
        },
    };
}
