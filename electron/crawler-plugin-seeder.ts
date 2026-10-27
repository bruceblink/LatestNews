import { join, dirname, resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { rm, mkdir, rename, mkdtemp } from "node:fs/promises";

import { builtinCrawlerPlugins } from "../crawler-platform/builtin-plugins";
import { parseCrawlerPluginManifest } from "../crawler-platform/sdk/manifest";
import { parseCrawlerJson, verifyCrawlerPluginArtifact } from "../crawler-platform/host/plugin-package";
import { installCrawlerPluginPackage, listInstalledCrawlerPlugins } from "../crawler-platform/host/plugin-store";

export interface BuiltinCrawlerPluginSeedResult {
    available: boolean;
    installedPluginIds: string[];
    enabledPluginIds: string[];
}

/** Seed first-party packages once for a fresh profile; preserve every existing package and selection. */
export async function seedBuiltinCrawlerPlugins(
    userPluginRoot: string,
    bundledPluginRoot: string
): Promise<BuiltinCrawlerPluginSeedResult> {
    const pluginRoot = resolve(userPluginRoot);
    const bundleRoot = resolve(bundledPluginRoot);
    const bundlePaths = builtinCrawlerPlugins.map((plugin) => ({
        id: plugin.id,
        path: join(bundleRoot, plugin.id),
    }));

    if (!bundlePaths.every(({ path }) => existsSync(path))) {
        return { available: false, installedPluginIds: [], enabledPluginIds: [] };
    }
    // Verify all shipped identities before changing the user's store. Hashes detect corruption, not trust.
    for (const bundle of bundlePaths) {
        const manifest = parseCrawlerPluginManifest(
            parseCrawlerJson(readFileSync(join(bundle.path, "manifest.json"), "utf8"), "plugin manifest")
        );
        if (manifest.id !== bundle.id || !manifest.targets.includes("electron")) {
            throw new Error(`Bundled plugin ${bundle.id} has an unexpected identity or target.`);
        }
        verifyCrawlerPluginArtifact(bundle.path, manifest, { required: true });
    }

    if (!existsSync(pluginRoot)) {
        return seedFreshProfile(pluginRoot, bundlePaths);
    }

    const installed = listInstalledCrawlerPlugins(pluginRoot);
    const installedIds = new Set(installed.map((plugin) => plugin.id));
    const installedPluginIds: string[] = [];
    for (const plugin of bundlePaths) {
        if (installedIds.has(plugin.id)) continue;
        await installCrawlerPluginPackage(plugin.path, pluginRoot, { action: "install" });
        installedIds.add(plugin.id);
        installedPluginIds.push(plugin.id);
    }

    const nextInstalled = listInstalledCrawlerPlugins(pluginRoot);
    return {
        available: true,
        installedPluginIds,
        enabledPluginIds: nextInstalled.filter((plugin) => plugin.enabled).map((plugin) => plugin.id),
    };
}

/** Build a complete default plugin store off to the side, then publish it with one same-volume rename. */
async function seedFreshProfile(
    pluginRoot: string,
    bundles: Array<{ id: string; path: string }>
): Promise<BuiltinCrawlerPluginSeedResult> {
    const parent = dirname(pluginRoot);
    await mkdir(parent, { recursive: true });
    const stagingRoot = await mkdtemp(join(parent, ".latestnews-crawler-seed-"));
    try {
        for (const bundle of bundles) {
            await installCrawlerPluginPackage(bundle.path, stagingRoot, { action: "install", enable: true });
        }
        await rename(stagingRoot, pluginRoot);
        const installed = listInstalledCrawlerPlugins(pluginRoot);
        return {
            available: true,
            installedPluginIds: bundles.map((bundle) => bundle.id),
            enabledPluginIds: installed.filter((plugin) => plugin.enabled).map((plugin) => plugin.id),
        };
    } finally {
        if (existsSync(stagingRoot)) await rm(stagingRoot, { recursive: true, force: true });
    }
}
