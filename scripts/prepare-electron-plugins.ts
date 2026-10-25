import { join, resolve } from "node:path";
import { rm, mkdir, rename, mkdtemp } from "node:fs/promises";

import { bundlePluginPackage } from "../crawler-platform/cli";
import { builtinCrawlerPlugins } from "../crawler-platform/builtin-plugins";

const projectRoot = resolve(import.meta.dirname, "..");
const outputParent = join(projectRoot, "out", "crawler-platform");
const outputRoot = join(outputParent, "builtin-plugins");
await mkdir(outputParent, { recursive: true });
const stagingRoot = await mkdtemp(join(outputParent, ".builtin-plugins-"));

// Publish only a complete set of verified bundles; never execute adapters while building.
try {
    for (const plugin of builtinCrawlerPlugins) {
        const result = await bundlePluginPackage(
            join(projectRoot, "crawler-platform", "plugins", plugin.sourceDirectory),
            join(stagingRoot, plugin.id)
        );
        if (result.manifest.id !== plugin.id || !result.manifest.targets.includes("electron")) {
            throw new Error(`Bundled plugin ${plugin.id} has an unexpected identity or target.`);
        }
    }
    await rm(outputRoot, { recursive: true, force: true });
    await rename(stagingRoot, outputRoot);
    console.info(`Prepared ${builtinCrawlerPlugins.length} desktop crawler plugin packages.`);
} finally {
    await rm(stagingRoot, { recursive: true, force: true });
}
