import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { it, expect, describe } from "vitest";
import { cp, rm, mkdtemp, readFile, writeFile } from "node:fs/promises";

import { CrawlerPlatformError } from "../crawler-platform/core/errors";
import { parseCrawlerPluginCatalog } from "../crawler-platform/sdk/catalog";
import { runCrawlerCli, bundlePluginPackage } from "../crawler-platform/cli";
import { createCrawlerPluginProvider } from "../crawler-platform/host/plugin-provider";
import { resolveInstalledPluginPackage } from "../crawler-platform/host/plugin-package";
import {
    pinCrawlerPluginVersion,
    setCrawlerPluginEnabled,
    unpinCrawlerPluginVersion,
    installCrawlerPluginPackage,
    listInstalledCrawlerPlugins,
    readEnabledCrawlerPluginIds,
    rollbackCrawlerPluginVersion,
    selectLatestCrawlerPluginVersion,
} from "../crawler-platform/host/plugin-store";

const pluginId = "org.latestnews.example-json";
const sourceDirectory = join(process.cwd(), "crawler-platform", "examples", "json");
const workerPath = join(process.cwd(), "crawler-platform", "runtime", "worker-entry.mjs");

describe("crawler plugin package lifecycle", () => {
    it("selects the latest semantic version without losing large numeric identifiers", () => {
        expect(selectLatestCrawlerPluginVersion(["0.1.0-beta.8", "0.1.0-beta.11"])).toBe("0.1.0-beta.11");
        expect(selectLatestCrawlerPluginVersion(["999999999999999999.0.0", "1000000000000000000.0.0"])).toBe(
            "1000000000000000000.0.0"
        );
    });

    it("installs, updates, pins, rolls back, and disables a versioned package", async () => {
        const root = await mkdtemp(join(tmpdir(), "latestnews-plugin-lifecycle-"));
        try {
            const bundles = await createVersionedBundles(root, ["0.1.0", "0.2.0", "0.3.0"]);
            const store = join(root, "store");

            await installCrawlerPluginPackage(bundles.get("0.1.0")!, store, { action: "install", enable: true });
            expect(listInstalledCrawlerPlugins(store)).toMatchObject([
                { id: pluginId, activeVersion: "0.1.0", enabled: true, versioned: true, history: [] },
            ]);
            expect(readEnabledCrawlerPluginIds(join(store, "enabled.json"))).toEqual([pluginId]);

            const initialProvider = createProvider(store, [pluginId]);
            expect(initialProvider.listSourceIds()).toEqual([`ext.${pluginId}.latest`]);

            await installCrawlerPluginPackage(bundles.get("0.2.0")!, store, { action: "update" });
            expect(listInstalledCrawlerPlugins(store)[0]).toMatchObject({
                activeVersion: "0.2.0",
                history: ["0.1.0"],
            });
            expect(await pinCrawlerPluginVersion(store, pluginId)).toBe("0.2.0");
            await expect(
                installCrawlerPluginPackage(bundles.get("0.3.0")!, store, { action: "update" })
            ).rejects.toThrow("is pinned to 0.2.0");
            await expect(rollbackCrawlerPluginVersion(store, pluginId)).rejects.toThrow("is pinned");

            await unpinCrawlerPluginVersion(store, pluginId);
            await installCrawlerPluginPackage(bundles.get("0.3.0")!, store, { action: "update" });
            expect(listInstalledCrawlerPlugins(store)[0]).toMatchObject({
                activeVersion: "0.3.0",
                history: ["0.2.0", "0.1.0"],
            });

            expect(await rollbackCrawlerPluginVersion(store, pluginId)).toBe("0.2.0");
            expect(resolveInstalledPluginPackage(join(store, "packages"), pluginId).activation).toMatchObject({
                activeVersion: "0.2.0",
                history: ["0.3.0", "0.1.0"],
            });
            expect(createProvider(store, [pluginId]).listSourceIds()).toEqual([`ext.${pluginId}.latest`]);

            await setCrawlerPluginEnabled(store, pluginId, false);
            expect(readEnabledCrawlerPluginIds(join(store, "enabled.json"))).toEqual([]);
            expect(createProvider(store, []).listSourceIds()).toEqual([]);
            await writeFile(
                join(store, "enabled.json"),
                JSON.stringify({ enabledPluginIds: [pluginId, pluginId] }),
                "utf8"
            );
            expect(() => readEnabledCrawlerPluginIds(join(store, "enabled.json"))).toThrowError(CrawlerPlatformError);
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    it("migrates a legacy flat bundle before pinning and keeps the legacy copy intact", async () => {
        const root = await mkdtemp(join(tmpdir(), "latestnews-plugin-migration-"));
        try {
            const bundleDirectory = join(root, "bundle");
            const legacyStore = join(root, "store");
            await bundlePluginPackage(sourceDirectory, bundleDirectory);
            await cp(bundleDirectory, join(legacyStore, pluginId), { recursive: true });

            expect(resolveInstalledPluginPackage(legacyStore, pluginId).versioned).toBe(false);
            expect(await pinCrawlerPluginVersion(legacyStore, pluginId)).toBe("0.1.0");
            expect(resolveInstalledPluginPackage(join(legacyStore, "packages"), pluginId).versioned).toBe(true);
            expect(await readFile(join(legacyStore, pluginId, "manifest.json"), "utf8")).toContain(
                '"entry": "plugin.mjs"'
            );
            expect(listInstalledCrawlerPlugins(legacyStore)).toMatchObject([
                { id: pluginId, activeVersion: "0.1.0", versioned: true, pinnedVersion: "0.1.0" },
            ]);
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    it("rejects modified package content and activation path traversal", async () => {
        const root = await mkdtemp(join(tmpdir(), "latestnews-plugin-integrity-"));
        try {
            const bundles = await createVersionedBundles(root, ["0.1.0", "0.2.0"]);
            const corruptBundle = join(root, "corrupt-bundle");
            await cp(bundles.get("0.2.0")!, corruptBundle, { recursive: true });
            await writeFile(join(corruptBundle, "plugin.mjs"), "// changed content\n", "utf8");
            const store = join(root, "store");
            await installCrawlerPluginPackage(bundles.get("0.1.0")!, store, { action: "install" });
            await expect(installCrawlerPluginPackage(corruptBundle, store, { action: "update" })).rejects.toMatchObject(
                { code: "INVALID_ARTIFACT" }
            );
            expect(resolveInstalledPluginPackage(join(store, "packages"), pluginId).activation?.activeVersion).toBe(
                "0.1.0"
            );

            const pointerPath = join(store, "packages", pluginId, "active.json");
            await writeFile(
                pointerPath,
                `${JSON.stringify({ formatVersion: 1, activeVersion: "../outside", history: [] })}\n`,
                "utf8"
            );
            expect(() => resolveInstalledPluginPackage(join(store, "packages"), pluginId)).toThrowError(
                CrawlerPlatformError
            );
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    it("validates the static catalog and installs the declared plugin through the CLI", async () => {
        const root = await mkdtemp(join(tmpdir(), "latestnews-plugin-catalog-"));
        try {
            expect(() =>
                parseCrawlerPluginCatalog({
                    catalogVersion: 1,
                    plugins: [
                        {
                            id: pluginId,
                            name: "JSON 示例",
                            versions: [{ version: "0.1.0", sourcePath: "../outside" }],
                        },
                    ],
                })
            ).toThrowError(CrawlerPlatformError);
            expect(() =>
                parseCrawlerPluginCatalog({
                    catalogVersion: 1,
                    plugins: [
                        {
                            id: pluginId,
                            name: "JSON 示例",
                            versions: [{ version: "0.1.0", sourcePath: "examples/json" }],
                        },
                        {
                            id: pluginId,
                            name: "重复插件",
                            versions: [{ version: "0.1.0", sourcePath: "examples/json" }],
                        },
                    ],
                })
            ).toThrowError(CrawlerPlatformError);

            const invalidCatalog = join(root, "invalid-catalog.json");
            await writeFile(
                invalidCatalog,
                JSON.stringify({
                    catalogVersion: 1,
                    plugins: [
                        { id: pluginId, name: "JSON 示例", versions: [{ version: "0.1.0", sourcePath: "../outside" }] },
                    ],
                }),
                "utf8"
            );
            expect(await runCrawlerCli(["catalog", "validate", invalidCatalog])).toBe(1);
            const builtInCatalog = join(process.cwd(), "crawler-platform", "catalog.json");
            expect(await runCrawlerCli(["catalog", "validate", builtInCatalog])).toBe(0);
            const installCode = await runCrawlerCli([
                "install",
                builtInCatalog,
                "org.latestnews.pcbeta",
                "--root",
                join(root, "store"),
                "--enable",
            ]);
            expect(installCode).toBe(0);
            expect(listInstalledCrawlerPlugins(join(root, "store"))).toMatchObject([
                { id: "org.latestnews.pcbeta", activeVersion: "0.1.0", enabled: true },
            ]);
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });
});

async function createVersionedBundles(root: string, versions: string[]) {
    const bundles = new Map<string, string>();
    const baseBundle = join(root, "base-bundle");
    await bundlePluginPackage(sourceDirectory, baseBundle);
    const baseManifest = JSON.parse(await readFile(join(baseBundle, "manifest.json"), "utf8")) as Record<
        string,
        unknown
    >;
    const baseArtifact = JSON.parse(await readFile(join(baseBundle, "artifact.json"), "utf8")) as Record<
        string,
        unknown
    >;
    for (const version of versions) {
        const bundle = join(root, `bundle-${version}`);
        await cp(baseBundle, bundle, { recursive: true });
        const manifest = { ...baseManifest, version };
        const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
        const artifact = {
            ...baseArtifact,
            pluginVersion: version,
            manifestSha256: createHash("sha256").update(manifestText).digest("hex"),
        };
        await writeFile(join(bundle, "manifest.json"), manifestText, "utf8");
        await writeFile(join(bundle, "artifact.json"), `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
        bundles.set(version, bundle);
    }
    return bundles;
}

function createProvider(pluginDirectory: string, enabledPluginIds: string[]) {
    return createCrawlerPluginProvider({
        pluginDirectory,
        enabledPluginIds,
        acceptedSourceIds: new Set(),
        target: "node",
        workerPath,
        createHost: () => ({ collect: async () => [] }),
    });
}
