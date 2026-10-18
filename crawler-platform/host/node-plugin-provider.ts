import { createNodeCrawlerHost } from "./node-host";
import { createCrawlerPluginProvider } from "./plugin-provider";

import type { NodeCrawlerHostOptions } from "./node-host";
import type { CrawlerPluginProviderOptions } from "./plugin-provider";

export interface NodeCrawlerPluginProviderOptions extends Omit<CrawlerPluginProviderOptions, "target" | "createHost"> {
    requestHandler?: NodeCrawlerHostOptions["requestHandler"];
}

/** Bind the shared plugin package loader to the Node child-process host. */
export function createNodeCrawlerPluginProvider(options: NodeCrawlerPluginProviderOptions) {
    return createCrawlerPluginProvider({
        ...options,
        target: "node",
        createHost: () =>
            createNodeCrawlerHost({
                workerPath: options.workerPath,
                timeoutMs: 15000,
                ...(options.requestHandler ? { requestHandler: options.requestHandler } : {}),
            }),
    });
}
