import { z } from "zod";
import { randomUUID } from "node:crypto";
import { rm, mkdir, rename, mkdtemp, copyFile, writeFile } from "node:fs/promises";
import { sep, join, resolve, dirname, relative, basename, isAbsolute } from "node:path";
import { statSync, lstatSync, existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";

import { CrawlerPlatformError } from "../core/errors";
import { parseCrawlerPluginManifest } from "../sdk/manifest";
import {
    parseCrawlerJson,
    createCrawlerPluginArtifact,
    verifyCrawlerPluginArtifact,
    resolveInstalledPluginPackage,
} from "./plugin-package";

import type { CrawlerPluginManifest } from "../sdk/manifest";
import type { CrawlerPluginActivationPointer } from "./plugin-package";

const pluginIdPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const enabledSettingsSchema = z
    .object({
        enabledPluginIds: z.array(z.string().min(3).max(64).regex(pluginIdPattern)).max(256),
    })
    .strict()
    .superRefine((settings, context) => {
        if (new Set(settings.enabledPluginIds).size !== settings.enabledPluginIds.length) {
            context.addIssue({ code: "custom", path: ["enabledPluginIds"], message: "Plugin IDs must be unique." });
        }
    });

const MAX_PACKAGE_FILE_BYTES = 10 * 1024 * 1024;
const MAX_SETTINGS_BYTES = 32 * 1024;

export interface InstallPluginOptions {
    action: "install" | "update";
    enable?: boolean;
}

export interface InstalledPluginInfo {
    id: string;
    name: string;
    activeVersion: string;
    enabled: boolean;
    versioned: boolean;
    history: string[];
    pinnedVersion?: string;
}

interface CurrentPlugin {
    directory: string;
    packageRoot: string;
    manifest: CrawlerPluginManifest;
    versioned: boolean;
    activation?: CrawlerPluginActivationPointer;
}

/** Read an existing enabled.json file and reject ambiguous or duplicate plugin IDs. */
export function readEnabledCrawlerPluginIds(settingsPath: string): string[] {
    if (!existsSync(settingsPath)) return [];
    const stats = lstatSync(settingsPath);
    if (!stats.isFile() || stats.isSymbolicLink() || stats.size > MAX_SETTINGS_BYTES) {
        throw new CrawlerPlatformError("INVALID_ARTIFACT", "enabled.json is not a valid bounded settings file.");
    }
    const result = enabledSettingsSchema.safeParse(
        parseCrawlerJson(readFileSync(settingsPath, "utf8"), "enabled.json")
    );
    if (!result.success) {
        throw new CrawlerPlatformError("INVALID_ARTIFACT", "enabled.json contains invalid or duplicate plugin IDs.");
    }
    return result.data.enabledPluginIds;
}

/** Install a verified self-contained bundle, then atomically select its version. */
export async function installCrawlerPluginPackage(
    packageDirectory: string,
    storeRoot: string,
    { action, enable = false }: InstallPluginOptions
) {
    const bundle = readVerifiedBundle(packageDirectory);
    const canonicalRoot = resolve(storeRoot);
    await mkdir(canonicalRoot, { recursive: true });
    const store = realpathSync(canonicalRoot);
    assertSourcesAndStoreAreSeparate(bundle.root, store);

    const packagesRoot = join(store, "packages");
    await mkdir(packagesRoot, { recursive: true });
    const canonicalPackagesRoot = realpathSync(packagesRoot);
    assertPathWithin(store, canonicalPackagesRoot);
    let current = findCurrentPlugin(store, bundle.manifest.id);
    let pluginDirectory = current?.directory ?? join(canonicalPackagesRoot, bundle.manifest.id);

    if (action === "install" && current) {
        if (current.manifest.version === bundle.manifest.version) {
            current = await migrateLegacyPackage(store, current);
            assertSameVersionContent(current.packageRoot, bundle);
            if (enable) await setCrawlerPluginEnabled(store, bundle.manifest.id, true);
            return { id: bundle.manifest.id, version: bundle.manifest.version, unchanged: true };
        }
        throw new Error(`Plugin ${bundle.manifest.id} is already installed; use update to change its version.`);
    }
    if (action === "update" && !current) {
        throw new Error(`Plugin ${bundle.manifest.id} is not installed; use install first.`);
    }
    if (current?.activation?.pinnedVersion && current.activation.pinnedVersion !== bundle.manifest.version) {
        throw new Error(`Plugin ${bundle.manifest.id} is pinned to ${current.activation.pinnedVersion}.`);
    }
    if (current && compareVersions(bundle.manifest.version, current.manifest.version) <= 0) {
        throw new Error(`Update version ${bundle.manifest.version} must be newer than ${current.manifest.version}.`);
    }

    if (current && !current.versioned) {
        current = await migrateLegacyPackage(store, current);
        pluginDirectory = current.directory;
    }
    const previousActivation = current?.activation;
    await installBundleVersion(pluginDirectory, bundle);

    const nextActivation: CrawlerPluginActivationPointer = {
        formatVersion: 1,
        activeVersion: bundle.manifest.version,
        history: current
            ? [
                  current.manifest.version,
                  ...(previousActivation?.history ?? []).filter((version) => version !== current.manifest.version),
              ].slice(0, 16)
            : [],
    };

    await writeJsonAtomically(join(pluginDirectory, "active.json"), nextActivation);
    if (enable) await setCrawlerPluginEnabled(store, bundle.manifest.id, true);

    return { id: bundle.manifest.id, version: bundle.manifest.version, unchanged: false };
}

/** Enable a package only after a valid active or legacy bundle is present. */
export async function setCrawlerPluginEnabled(storeRoot: string, pluginId: string, enabled: boolean) {
    assertPluginId(pluginId);
    const root = resolve(storeRoot);
    if (!findCurrentPlugin(root, pluginId)) throw new Error(`Plugin ${pluginId} is not installed.`);

    const settingsPath = join(root, "enabled.json");
    const enabledIds = new Set(readEnabledCrawlerPluginIds(settingsPath));
    if (enabled) enabledIds.add(pluginId);
    else enabledIds.delete(pluginId);
    await writeJsonAtomically(settingsPath, { enabledPluginIds: [...enabledIds].sort() });
    return [...enabledIds].sort();
}

/** List installed versions and active settings without importing plugin code. */
export function listInstalledCrawlerPlugins(storeRoot: string): InstalledPluginInfo[] {
    const root = resolve(storeRoot);
    if (!existsSync(root)) return [];
    const enabled = new Set(readEnabledCrawlerPluginIds(join(root, "enabled.json")));
    const found = new Map<string, InstalledPluginInfo>();
    for (const searchRoot of getPackageSearchRoots(root)) {
        for (const entry of readdirSync(searchRoot, { withFileTypes: true })) {
            if (!entry.isDirectory() || found.has(entry.name)) continue;
            try {
                const current = findCurrentPluginInRoot(searchRoot, entry.name);
                if (!current) continue;
                found.set(entry.name, {
                    id: entry.name,
                    name: current.manifest.name,
                    activeVersion: current.manifest.version,
                    enabled: enabled.has(entry.name),
                    versioned: current.versioned,
                    history: current.activation?.history ?? [],
                    ...(current.activation?.pinnedVersion ? { pinnedVersion: current.activation.pinnedVersion } : {}),
                });
            } catch {
                // Invalid packages are omitted from the listing and still fail closed at host startup.
            }
        }
    }
    return [...found.values()].sort((left, right) => left.id.localeCompare(right.id));
}

/** Pin the active version so an update command cannot switch it until unpinned. */
export async function pinCrawlerPluginVersion(storeRoot: string, pluginId: string) {
    assertPluginId(pluginId);
    const root = resolve(storeRoot);
    let current = findCurrentPlugin(root, pluginId);
    if (!current) throw new Error(`Plugin ${pluginId} is not installed.`);
    if (!current.versioned) current = await migrateLegacyPackage(root, current);
    const activation = current.activation!;
    const pinned = { ...activation, pinnedVersion: activation.activeVersion };
    await writeJsonAtomically(join(current.directory, "active.json"), pinned);
    return pinned.pinnedVersion;
}

/** Clear the active version pin without deleting installed package versions. */
export async function unpinCrawlerPluginVersion(storeRoot: string, pluginId: string) {
    assertPluginId(pluginId);
    const current = findCurrentPlugin(resolve(storeRoot), pluginId);
    if (!current?.activation) throw new Error(`Plugin ${pluginId} has no versioned installation to unpin.`);
    const activation: CrawlerPluginActivationPointer = {
        formatVersion: current.activation.formatVersion,
        activeVersion: current.activation.activeVersion,
        history: current.activation.history,
    };
    await writeJsonAtomically(join(current.directory, "active.json"), activation);
}

/** Switch to the most recently replaced package version and preserve rollback history. */
export async function rollbackCrawlerPluginVersion(storeRoot: string, pluginId: string) {
    assertPluginId(pluginId);
    const current = findCurrentPlugin(resolve(storeRoot), pluginId);
    if (!current?.activation) throw new Error(`Plugin ${pluginId} has no version history to roll back.`);
    if (current.activation.pinnedVersion) throw new Error(`Plugin ${pluginId} is pinned; unpin it before rollback.`);
    const [version, ...remainingHistory] = current.activation.history;
    if (!version) throw new Error(`Plugin ${pluginId} has no previous version.`);

    const packageRoot = resolve(current.directory, "versions", version);
    const manifest = readManifest(packageRoot);
    if (manifest.id !== pluginId || manifest.version !== version) {
        throw new CrawlerPlatformError("INVALID_ARTIFACT", `Rollback package for ${pluginId}@${version} is invalid.`);
    }
    verifyCrawlerPluginArtifact(packageRoot, manifest, { required: true });
    const activation: CrawlerPluginActivationPointer = {
        formatVersion: 1,
        activeVersion: version,
        history: [current.manifest.version, ...remainingHistory].slice(0, 16),
    };
    await writeJsonAtomically(join(current.directory, "active.json"), activation);
    return version;
}

function readVerifiedBundle(packageDirectory: string) {
    const root = realpathSync(resolve(packageDirectory));
    const manifest = readManifest(root);
    if (manifest.entry !== "plugin.mjs") {
        throw new CrawlerPlatformError("INVALID_ARTIFACT", "Installable package entry must be plugin.mjs.");
    }
    const artifact = verifyCrawlerPluginArtifact(root, manifest, { required: true });
    if (!artifact) throw new CrawlerPlatformError("INVALID_ARTIFACT", "Package artifact verification failed.");
    const allowedFiles = new Set(["manifest.json", "plugin.mjs", "artifact.json"]);
    for (const entry of readdirSync(root, { withFileTypes: true })) {
        const filePath = join(root, entry.name);
        if (!allowedFiles.has(entry.name) || !entry.isFile() || lstatSync(filePath).isSymbolicLink()) {
            throw new CrawlerPlatformError(
                "INVALID_ARTIFACT",
                `Installable package contains unsupported file ${entry.name}.`
            );
        }
    }
    return { root, manifest, artifact };
}

async function installBundleVersion(pluginDirectory: string, bundle: ReturnType<typeof readVerifiedBundle>) {
    const versionsDirectory = join(pluginDirectory, "versions");
    const versionDirectory = join(versionsDirectory, bundle.manifest.version);
    await mkdir(versionsDirectory, { recursive: true });
    if (existsSync(versionDirectory)) {
        const installed = readVerifiedBundle(versionDirectory);
        assertSameArtifact(installed.artifact, bundle.artifact);
        return;
    }

    const stagingDirectory = await mkdtemp(join(versionsDirectory, `.install-${randomUUID()}-`));
    try {
        for (const filename of ["manifest.json", "plugin.mjs", "artifact.json"]) {
            await copyFile(join(bundle.root, filename), join(stagingDirectory, filename));
        }
        const staged = readVerifiedBundle(stagingDirectory);
        assertSameArtifact(staged.artifact, bundle.artifact);
        await rename(stagingDirectory, versionDirectory);
    } finally {
        if (existsSync(stagingDirectory)) await rm(stagingDirectory, { recursive: true, force: true });
    }
}

async function migrateLegacyPackage(storeRoot: string, current: CurrentPlugin): Promise<CurrentPlugin> {
    if (current.versioned) return current;
    const targetDirectory = join(storeRoot, "packages", current.manifest.id);
    const versionsDirectory = join(targetDirectory, "versions");
    const versionDirectory = join(versionsDirectory, current.manifest.version);
    await mkdir(versionsDirectory, { recursive: true });

    const { text: manifestText } = readPluginManifest(current.packageRoot);
    const entryPath = resolve(current.packageRoot, ...current.manifest.entry.split("/"));
    const canonicalEntry = realpathSync(entryPath);
    assertPathWithin(current.packageRoot, canonicalEntry);
    const entryBytes = readFileSync(canonicalEntry);
    if (current.manifest.entry !== "plugin.mjs" || entryBytes.byteLength > MAX_PACKAGE_FILE_BYTES) {
        throw new CrawlerPlatformError(
            "INVALID_ARTIFACT",
            "Legacy plugin cannot be migrated as a self-contained bundle."
        );
    }

    const legacyArtifactPath = join(current.packageRoot, "artifact.json");
    let artifactText: string;
    let expectedArtifact = verifyCrawlerPluginArtifact(current.packageRoot, current.manifest, { required: false });
    if (expectedArtifact) {
        const canonicalArtifact = realpathSync(legacyArtifactPath);
        assertPathWithin(current.packageRoot, canonicalArtifact);
        artifactText = readFileSync(canonicalArtifact, "utf8");
    } else {
        expectedArtifact = createCrawlerPluginArtifact(current.manifest, manifestText, entryBytes);
        artifactText = `${JSON.stringify(expectedArtifact, null, 2)}\n`;
    }

    if (existsSync(versionDirectory)) {
        const existingManifest = readManifest(versionDirectory);
        const existingArtifact = verifyCrawlerPluginArtifact(versionDirectory, existingManifest, { required: true });
        if (!existingArtifact)
            throw new CrawlerPlatformError("INVALID_ARTIFACT", "Migrated version has no artifact metadata.");
        assertSameArtifact(existingArtifact, expectedArtifact);
    } else {
        const stagingDirectory = await mkdtemp(join(versionsDirectory, `.migrate-${randomUUID()}-`));
        try {
            await writeFile(join(stagingDirectory, "manifest.json"), manifestText, { flag: "wx" });
            await writeFile(join(stagingDirectory, "plugin.mjs"), entryBytes, { flag: "wx" });
            await writeFile(join(stagingDirectory, "artifact.json"), artifactText, { flag: "wx" });
            verifyCrawlerPluginArtifact(stagingDirectory, current.manifest, { required: true });
            await rename(stagingDirectory, versionDirectory);
        } finally {
            if (existsSync(stagingDirectory)) await rm(stagingDirectory, { recursive: true, force: true });
        }
    }

    const activation: CrawlerPluginActivationPointer = {
        formatVersion: 1,
        activeVersion: current.manifest.version,
        history: [],
    };
    await writeJsonAtomically(join(targetDirectory, "active.json"), activation);
    const migrated = findCurrentPlugin(storeRoot, current.manifest.id);
    if (!migrated) throw new Error(`Legacy plugin ${current.manifest.id} could not be migrated.`);
    return migrated;
}

function findCurrentPlugin(storeRoot: string, pluginId: string): CurrentPlugin | undefined {
    assertPluginId(pluginId);
    for (const searchRoot of getPackageSearchRoots(storeRoot)) {
        const current = findCurrentPluginInRoot(searchRoot, pluginId);
        if (current) return current;
    }
    return undefined;
}

function findCurrentPluginInRoot(searchRoot: string, pluginId: string): CurrentPlugin | undefined {
    const directory = join(searchRoot, pluginId);
    if (!existsSync(directory)) return undefined;
    const resolved = resolveInstalledPluginPackage(searchRoot, pluginId);
    const manifest = readManifest(resolved.packageRoot);
    if (manifest.id !== pluginId) {
        throw new CrawlerPlatformError(
            "INVALID_ARTIFACT",
            `Package directory ${pluginId} contains plugin ${manifest.id}.`
        );
    }
    verifyCrawlerPluginArtifact(resolved.packageRoot, manifest, { required: resolved.versioned });
    return {
        directory,
        packageRoot: resolved.packageRoot,
        manifest,
        versioned: resolved.versioned,
        activation: resolved.activation,
    };
}

function getPackageSearchRoots(storeRoot: string) {
    const root = resolve(storeRoot);
    const packagesRoot = join(root, "packages");
    if (!existsSync(packagesRoot)) return [root];
    const canonicalRoot = realpathSync(root);
    const canonicalPackagesRoot = realpathSync(packagesRoot);
    assertPathWithin(canonicalRoot, canonicalPackagesRoot);
    return [canonicalPackagesRoot, canonicalRoot];
}

function readManifest(packageRoot: string) {
    return readPluginManifest(packageRoot).manifest;
}

function readPluginManifest(packageRoot: string) {
    const canonicalRoot = realpathSync(packageRoot);
    const canonicalManifestPath = realpathSync(join(canonicalRoot, "manifest.json"));
    assertPathWithin(canonicalRoot, canonicalManifestPath);
    const text = readBoundedFile(canonicalManifestPath, 64 * 1024, "plugin manifest");
    const manifest = parseCrawlerPluginManifest(parseCrawlerJson(text, "plugin manifest"));
    return { manifest, text };
}

function readBoundedFile(path: string, maxBytes: number, label: string) {
    const canonicalPath = realpathSync(path);
    const stats = statSync(canonicalPath);
    if (!stats.isFile() || stats.size > maxBytes) {
        throw new CrawlerPlatformError("INVALID_ARTIFACT", `${label} exceeds the ${maxBytes}-byte limit.`);
    }
    return readFileSync(canonicalPath, "utf8");
}

function assertSameVersionContent(installedPackageRoot: string, bundle: ReturnType<typeof readVerifiedBundle>) {
    const installedArtifact = verifyCrawlerPluginArtifact(installedPackageRoot, readManifest(installedPackageRoot), {
        required: true,
    });
    if (!installedArtifact)
        throw new CrawlerPlatformError("INVALID_ARTIFACT", "Installed package has no artifact metadata.");
    assertSameArtifact(installedArtifact, bundle.artifact);
}

function assertSameArtifact(
    left: NonNullable<ReturnType<typeof verifyCrawlerPluginArtifact>>,
    right: NonNullable<ReturnType<typeof verifyCrawlerPluginArtifact>>
) {
    if (left.pluginSha256 !== right.pluginSha256 || left.manifestSha256 !== right.manifestSha256) {
        throw new CrawlerPlatformError("INVALID_ARTIFACT", "A plugin version already exists with different content.");
    }
}

async function writeJsonAtomically(path: string, value: unknown) {
    await mkdir(dirname(path), { recursive: true });
    const temporaryPath = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
    try {
        await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
        try {
            await rename(temporaryPath, path);
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (code !== "EEXIST" && code !== "EPERM" && code !== "ENOTEMPTY") throw error;
            // Windows cannot replace an existing file with rename(). Remove the
            // old pointer as a compatibility fallback, then publish the fully
            // written temporary file from the same directory.
            await rm(path, { force: true });
            await rename(temporaryPath, path);
        }
    } finally {
        if (existsSync(temporaryPath)) await rm(temporaryPath, { force: true });
    }
}

function assertSourcesAndStoreAreSeparate(sourceRoot: string, storeRoot: string) {
    const sourceToStore = relative(sourceRoot, storeRoot);
    const storeToSource = relative(storeRoot, sourceRoot);
    const sourceContainsStore =
        sourceToStore === "" ||
        (!isAbsolute(sourceToStore) && !sourceToStore.startsWith(`..${sep}`) && sourceToStore !== "..");
    const storeContainsSource =
        storeToSource === "" ||
        (!isAbsolute(storeToSource) && !storeToSource.startsWith(`..${sep}`) && storeToSource !== "..");
    if (sourceContainsStore || storeContainsSource) {
        throw new CrawlerPlatformError(
            "INVALID_ARTIFACT",
            "Plugin source and plugin store must use separate directories."
        );
    }
}

function assertPathWithin(root: string, candidate: string) {
    const relativePath = relative(root, candidate);
    if (!relativePath || relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
        throw new CrawlerPlatformError("INVALID_ARTIFACT", `Plugin store path escapes its root: ${candidate}`);
    }
}

export function selectLatestCrawlerPluginVersion(versions: readonly string[]) {
    const sorted = [...versions].sort(compareVersions);
    const latest = sorted[sorted.length - 1];
    if (!latest) throw new CrawlerPlatformError("INVALID_MANIFEST", "Plugin catalog has no versions.");
    return latest;
}

function compareVersions(left: string, right: string) {
    const leftMatch = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(.*))?$/.exec(left);
    const rightMatch = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(.*))?$/.exec(right);
    if (!leftMatch || !rightMatch) throw new CrawlerPlatformError("INVALID_MANIFEST", "Plugin version is invalid.");

    for (let index = 1; index <= 3; index += 1) {
        const difference = compareNumericIdentifiers(leftMatch[index]!, rightMatch[index]!);
        if (difference !== 0) return difference;
    }
    const leftPreRelease = leftMatch[4];
    const rightPreRelease = rightMatch[4];
    if (leftPreRelease === undefined) return 1;
    if (rightPreRelease === undefined) return -1;
    const leftIdentifiers = leftPreRelease.split(".");
    const rightIdentifiers = rightPreRelease.split(".");
    for (let index = 0; index < Math.max(leftIdentifiers.length, rightIdentifiers.length); index += 1) {
        const leftIdentifier = leftIdentifiers[index];
        const rightIdentifier = rightIdentifiers[index];
        if (leftIdentifier === undefined) return -1;
        if (rightIdentifier === undefined) return 1;
        if (leftIdentifier === rightIdentifier) continue;

        const leftIsNumeric = /^\d+$/.test(leftIdentifier);
        const rightIsNumeric = /^\d+$/.test(rightIdentifier);
        if (leftIsNumeric && rightIsNumeric) return compareNumericIdentifiers(leftIdentifier, rightIdentifier);
        if (leftIsNumeric !== rightIsNumeric) return leftIsNumeric ? -1 : 1;
        return leftIdentifier < rightIdentifier ? -1 : 1;
    }
    return 0;
}

function compareNumericIdentifiers(left: string, right: string) {
    if (left.length !== right.length) return left.length < right.length ? -1 : 1;
    return left === right ? 0 : left < right ? -1 : 1;
}

function assertPluginId(pluginId: string) {
    if (pluginId.length < 3 || pluginId.length > 64 || !pluginIdPattern.test(pluginId)) {
        throw new CrawlerPlatformError("INVALID_MANIFEST", `Invalid plugin ID ${pluginId}.`);
    }
}
