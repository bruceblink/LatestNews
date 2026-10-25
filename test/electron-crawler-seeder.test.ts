import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { it, expect, describe, afterAll, beforeAll } from "vitest";
import { cp, rm, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";

import { bundlePluginPackage } from "../crawler-platform/cli";
import { builtinCrawlerPlugins } from "../crawler-platform/builtin-plugins";
import { seedBuiltinCrawlerPlugins } from "../electron/crawler-plugin-seeder";
import { parseCrawlerPluginManifest } from "../crawler-platform/sdk/manifest";
import { createCrawlerPluginArtifact } from "../crawler-platform/host/plugin-package";
import {
    pinCrawlerPluginVersion,
    setCrawlerPluginEnabled,
    listInstalledCrawlerPlugins,
    installCrawlerPluginPackage,
} from "../crawler-platform/host/plugin-store";

let root: string;
let bundleRoot: string;
const pluginIds = builtinCrawlerPlugins.map((plugin) => plugin.id).sort();

beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "latestnews-builtin-seed-"));
    bundleRoot = join(root, "bundles");
    for (const plugin of builtinCrawlerPlugins) {
        await bundlePluginPackage(
            join(process.cwd(), "crawler-platform", "plugins", plugin.sourceDirectory),
            join(bundleRoot, plugin.id)
        );
    }
}, 30_000);

afterAll(async () => {
    if (root) await rm(root, { recursive: true, force: true });
});

describe("bundled desktop crawler plugin seeding", () => {
    it("installs and enables a fresh profile once with verified versioned packages", async () => {
        const store = join(root, "fresh", "crawler-plugins");
        const first = await seedBuiltinCrawlerPlugins(store, bundleRoot);
        expect(first.available).toBe(true);
        expect(first.installedPluginIds.sort()).toEqual(pluginIds);
        expect(first.enabledPluginIds.sort()).toEqual(pluginIds);
        expect(listInstalledCrawlerPlugins(store)).toHaveLength(4);

        const settings = await readFile(join(store, "enabled.json"), "utf8");
        const second = await seedBuiltinCrawlerPlugins(store, bundleRoot);
        expect(second.installedPluginIds).toEqual([]);
        expect(await readFile(join(store, "enabled.json"), "utf8")).toBe(settings);
    });

    it("adds missing packages to an existing store without enabling them", async () => {
        const store = join(root, "existing");
        await mkdir(store);
        const settings = '{"enabledPluginIds":[]}\n';
        await writeFile(join(store, "enabled.json"), settings);
        const result = await seedBuiltinCrawlerPlugins(store, bundleRoot);
        expect(result.installedPluginIds.sort()).toEqual(pluginIds);
        expect(result.enabledPluginIds).toEqual([]);
        expect(await readFile(join(store, "enabled.json"), "utf8")).toBe(settings);
    });

    it("installs workspace bundles into user data and still rejects overlapping directories", async () => {
        const cache = resolve(".cache");
        await mkdir(cache, { recursive: true });
        const shipped = await mkdtemp(join(cache, "builtin-seed-regression-"));
        try {
            await cp(bundleRoot, shipped, { recursive: true });
            const store = join(root, "workspace-bundle-store");
            const result = await seedBuiltinCrawlerPlugins(store, shipped);
            expect(result.enabledPluginIds.sort()).toEqual(pluginIds);
            const bundle = join(shipped, builtinCrawlerPlugins[0].id);
            await expect(installCrawlerPluginPackage(bundle, bundle, { action: "install" })).rejects.toThrow(
                "separate directories"
            );
            await expect(installCrawlerPluginPackage(bundle, shipped, { action: "install" })).rejects.toThrow(
                "separate directories"
            );
            await expect(
                installCrawlerPluginPackage(bundle, join(bundle, "nested-store"), { action: "install" })
            ).rejects.toThrow("separate directories");
        } finally {
            await rm(shipped, { recursive: true, force: true });
        }
    });

    it("preserves installed versions, pins and user-selected enabled plugins", async () => {
        const store = join(root, "custom");
        const id = builtinCrawlerPlugins[0].id;
        const customBundle = join(root, "custom-bundle");
        await cp(join(bundleRoot, id), customBundle, { recursive: true });
        await rewriteManifest(customBundle, { version: "9.0.0" });
        await installCrawlerPluginPackage(customBundle, store, { action: "install", enable: true });
        await pinCrawlerPluginVersion(store, id);
        const activePath = join(store, "packages", id, "active.json");
        const pointer = await readFile(activePath, "utf8");
        const settings = await readFile(join(store, "enabled.json"), "utf8");

        const result = await seedBuiltinCrawlerPlugins(store, bundleRoot);
        expect(result.installedPluginIds).not.toContain(id);
        expect(result.enabledPluginIds).toEqual([id]);
        expect(await readFile(activePath, "utf8")).toBe(pointer);
        expect(await readFile(join(store, "enabled.json"), "utf8")).toBe(settings);
        expect(listInstalledCrawlerPlugins(store).find((plugin) => plugin.id === id)).toMatchObject({
            activeVersion: "9.0.0",
            pinnedVersion: "9.0.0",
        });
        await setCrawlerPluginEnabled(store, id, false);
        await seedBuiltinCrawlerPlugins(store, bundleRoot);
        expect(listInstalledCrawlerPlugins(store).every((plugin) => !plugin.enabled)).toBe(true);
    });

    it("leaves a fresh profile untouched when resources are incomplete", async () => {
        const store = join(root, "missing-store");
        const result = await seedBuiltinCrawlerPlugins(store, join(root, "missing-bundles"));
        expect(result).toEqual({ available: false, installedPluginIds: [], enabledPluginIds: [] });
        expect(existsSync(store)).toBe(false);
    });

    it("rejects a damaged bundle before publishing a fresh store", async () => {
        const damaged = join(root, "damaged");
        const store = join(root, "damaged-store");
        await cp(bundleRoot, damaged, { recursive: true });
        await writeFile(join(damaged, builtinCrawlerPlugins[3].id, "plugin.mjs"), "throw new Error('damaged');\n");
        await expect(seedBuiltinCrawlerPlugins(store, damaged)).rejects.toThrow();
        expect(existsSync(store)).toBe(false);
    });

    it("rejects a valid artifact placed under another plugin's identity", async () => {
        const swapped = join(root, "swapped");
        const store = join(root, "swapped-store");
        await cp(bundleRoot, swapped, { recursive: true });
        await rewriteManifest(join(swapped, builtinCrawlerPlugins[0].id), { id: "org.latestnews.unexpected" });
        await expect(seedBuiltinCrawlerPlugins(store, swapped)).rejects.toThrow("unexpected identity");
        expect(existsSync(store)).toBe(false);
    });

    it("preserves invalid user settings and refuses to install over them", async () => {
        const store = join(root, "invalid-settings");
        await mkdir(store);
        await writeFile(join(store, "enabled.json"), "invalid JSON");
        await expect(seedBuiltinCrawlerPlugins(store, bundleRoot)).rejects.toThrow();
        expect(await readFile(join(store, "enabled.json"), "utf8")).toBe("invalid JSON");
        expect(existsSync(join(store, "packages"))).toBe(false);
    });
});

async function rewriteManifest(directory: string, changes: Record<string, string>) {
    const manifest = parseCrawlerPluginManifest({
        ...JSON.parse(await readFile(join(directory, "manifest.json"), "utf8")),
        ...changes,
    });
    const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
    await writeFile(join(directory, "manifest.json"), manifestText);
    await writeFile(
        join(directory, "artifact.json"),
        JSON.stringify(
            createCrawlerPluginArtifact(manifest, manifestText, await readFile(join(directory, "plugin.mjs")))
        )
    );
}
