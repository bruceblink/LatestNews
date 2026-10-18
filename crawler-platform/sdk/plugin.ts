import { parseCrawlerPluginManifest } from "./manifest";

import type { CrawlerPlugin, CrawlerPluginImplementation } from "./types";

/** Freeze validated metadata and expose the implementation through one stable SDK entry. */
export function defineCrawlerPlugin(manifest: unknown, implementation: CrawlerPluginImplementation): CrawlerPlugin {
    const parsedManifest = parseCrawlerPluginManifest(manifest);

    return Object.freeze({
        manifest: Object.freeze(parsedManifest),
        collect: implementation.collect,
    });
}
