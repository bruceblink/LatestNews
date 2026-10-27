import { z } from "zod";
import { createHash } from "node:crypto";
import { sep, join, resolve, relative, isAbsolute } from "node:path";
import { statSync, lstatSync, existsSync, readFileSync, realpathSync } from "node:fs";

import { CrawlerPlatformError } from "../core/errors";
import { parseCrawlerPluginManifest } from "../sdk/manifest";

import type { CrawlerPluginManifest } from "../sdk/manifest";

const versionPattern =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*)?$/;
const pluginIdPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const hashPattern = /^[a-f0-9]{64}$/;
const maxManifestBytes = 64 * 1024;
const maxArtifactBytes = 16 * 1024;
const maxPluginBytes = 10 * 1024 * 1024;

export function parseCrawlerJson(text: string, label: string): unknown {
    try {
        return JSON.parse(text) as unknown;
    } catch {
        throw new CrawlerPlatformError("INVALID_ARTIFACT", `${label} is not valid JSON.`);
    }
}

const pluginArtifactSchema = z
    .object({
        artifactVersion: z.literal(1),
        pluginId: z.string().min(3).max(64),
        pluginVersion: z.string().regex(versionPattern),
        targets: z
            .array(z.enum(["node", "electron"]))
            .min(1)
            .superRefine((targets, context) => {
                if (new Set(targets).size !== targets.length) {
                    context.addIssue({ code: "custom", message: "Artifact targets must be unique." });
                }
            }),
        pluginSha256: z.string().regex(hashPattern),
        manifestSha256: z.string().regex(hashPattern),
    })
    .strict();

const activationPointerSchema = z
    .object({
        formatVersion: z.literal(1),
        activeVersion: z.string().regex(versionPattern),
        history: z.array(z.string().regex(versionPattern)).max(16),
        pinnedVersion: z.string().regex(versionPattern).optional(),
    })
    .strict()
    .superRefine((pointer, context) => {
        if (new Set(pointer.history).size !== pointer.history.length) {
            context.addIssue({ code: "custom", path: ["history"], message: "History versions must be unique." });
        }
        if (pointer.history.includes(pointer.activeVersion)) {
            context.addIssue({
                code: "custom",
                path: ["history"],
                message: "Active version cannot also be in history.",
            });
        }
        if (pointer.pinnedVersion && pointer.pinnedVersion !== pointer.activeVersion) {
            context.addIssue({ code: "custom", path: ["pinnedVersion"], message: "Pinned version must be active." });
        }
    });

export type CrawlerPluginArtifact = z.infer<typeof pluginArtifactSchema>;
export type CrawlerPluginActivationPointer = z.infer<typeof activationPointerSchema>;

export interface ResolvedPluginPackage {
    packageRoot: string;
    versioned: boolean;
    activation?: CrawlerPluginActivationPointer;
}

/** Resolve a version pointer inside its plugin directory; legacy flat packages remain readable. */
export function resolveInstalledPluginPackage(pluginRoot: string, pluginId: string): ResolvedPluginPackage {
    if (!pluginIdPattern.test(pluginId)) {
        throw new CrawlerPlatformError("INVALID_ARTIFACT", `Invalid plugin ID ${pluginId}.`);
    }
    const canonicalRoot = realpathSync(pluginRoot);
    const pluginDirectory = realpathSync(resolve(canonicalRoot, pluginId));
    assertPathWithin(canonicalRoot, pluginDirectory);

    const activationPath = resolve(pluginDirectory, "active.json");
    let activationStat;
    try {
        activationStat = lstatSync(activationPath);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return { packageRoot: pluginDirectory, versioned: false };
        }
        throw error;
    }
    if (!activationStat.isFile() || activationStat.isSymbolicLink()) {
        throw new CrawlerPlatformError("INVALID_ARTIFACT", "Plugin active.json must be a regular file.");
    }
    assertPathWithin(pluginDirectory, realpathSync(activationPath));

    const activationText = readBoundedText(activationPath, maxManifestBytes, "activation pointer");
    const parsed = activationPointerSchema.safeParse(parseCrawlerJson(activationText, "Plugin activation pointer"));
    if (!parsed.success) {
        throw new CrawlerPlatformError("INVALID_ARTIFACT", `Plugin ${pluginId} has an invalid active.json pointer.`);
    }

    const packageRoot = realpathSync(join(pluginDirectory, "versions", parsed.data.activeVersion));
    assertPathWithin(pluginDirectory, packageRoot);
    const manifestPath = resolve(packageRoot, "manifest.json");
    assertPathWithin(packageRoot, realpathSync(manifestPath));
    const manifestText = readBoundedText(manifestPath, maxManifestBytes, "plugin manifest");
    const manifest = parseCrawlerPluginManifest(parseCrawlerJson(manifestText, "Plugin manifest"));
    if (manifest.id !== pluginId || manifest.version !== parsed.data.activeVersion) {
        throw new CrawlerPlatformError(
            "INVALID_ARTIFACT",
            `Active package for ${pluginId} does not match version ${parsed.data.activeVersion}.`
        );
    }
    if (manifest.entry !== "plugin.mjs") {
        throw new CrawlerPlatformError(
            "INVALID_ARTIFACT",
            "Versioned plugin entry must be the bundled plugin.mjs file."
        );
    }
    return {
        packageRoot,
        versioned: true,
        activation: parsed.data,
    };
}

/** Verify a package's manifest and bundle hashes before a worker can load its entry. */
export function verifyCrawlerPluginArtifact(
    packageRoot: string,
    manifest: CrawlerPluginManifest,
    { required = false }: { required?: boolean } = {}
): CrawlerPluginArtifact | undefined {
    const artifactPath = resolve(packageRoot, "artifact.json");
    if (!existsSync(artifactPath)) {
        if (required)
            throw new CrawlerPlatformError("INVALID_ARTIFACT", "Versioned plugin package has no artifact.json.");
        return undefined;
    }

    assertPathWithin(packageRoot, realpathSync(artifactPath));
    const artifactText = readBoundedText(artifactPath, maxArtifactBytes, "plugin artifact");
    const artifactResult = pluginArtifactSchema.safeParse(parseCrawlerJson(artifactText, "Plugin artifact"));
    if (!artifactResult.success) {
        throw new CrawlerPlatformError("INVALID_ARTIFACT", "Plugin artifact metadata is invalid.");
    }
    const artifact = artifactResult.data;
    if (
        artifact.pluginId !== manifest.id ||
        artifact.pluginVersion !== manifest.version ||
        !sameTargets(artifact.targets, manifest.targets)
    ) {
        throw new CrawlerPlatformError("INVALID_ARTIFACT", "Plugin artifact metadata does not match its manifest.");
    }

    const manifestPath = resolve(packageRoot, "manifest.json");
    const entryPath = resolve(packageRoot, ...manifest.entry.split("/"));
    assertPathWithin(packageRoot, realpathSync(manifestPath));
    assertPathWithin(packageRoot, realpathSync(entryPath));
    const manifestText = readBoundedText(manifestPath, maxManifestBytes, "plugin manifest");
    const pluginStat = statSync(entryPath);
    if (!pluginStat.isFile() || pluginStat.size > maxPluginBytes) {
        throw new CrawlerPlatformError("INVALID_ARTIFACT", `Plugin entry exceeds the ${maxPluginBytes}-byte limit.`);
    }
    const pluginHash = createHash("sha256").update(readFileSync(entryPath)).digest("hex");
    const manifestHash = createHash("sha256").update(manifestText).digest("hex");
    if (artifact.pluginSha256 !== pluginHash || artifact.manifestSha256 !== manifestHash) {
        throw new CrawlerPlatformError("INVALID_ARTIFACT", "Plugin package SHA-256 does not match artifact.json.");
    }

    return artifact;
}

export function parseCrawlerPluginActivationPointer(input: unknown): CrawlerPluginActivationPointer {
    const parsed = activationPointerSchema.safeParse(input);
    if (!parsed.success) {
        throw new CrawlerPlatformError("INVALID_ARTIFACT", "Plugin activation pointer is invalid.");
    }
    return parsed.data;
}

/** Create integrity metadata when migrating an already trusted legacy package. */
export function createCrawlerPluginArtifact(
    manifest: CrawlerPluginManifest,
    manifestText: string,
    pluginBytes: Uint8Array
): CrawlerPluginArtifact {
    return {
        artifactVersion: 1,
        pluginId: manifest.id,
        pluginVersion: manifest.version,
        targets: [...manifest.targets],
        pluginSha256: createHash("sha256").update(pluginBytes).digest("hex"),
        manifestSha256: createHash("sha256").update(manifestText).digest("hex"),
    };
}

function readBoundedText(path: string, maxBytes: number, label: string) {
    const filePath = realpathSync(path);
    const fileStat = statSync(filePath);
    if (!fileStat.isFile() || fileStat.size > maxBytes) {
        throw new CrawlerPlatformError("INVALID_ARTIFACT", `${label} exceeds the ${maxBytes}-byte limit.`);
    }
    return readFileSync(filePath, "utf8");
}

function assertPathWithin(root: string, candidate: string) {
    const relativePath = relative(root, candidate);
    if (!relativePath || relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
        throw new CrawlerPlatformError("INVALID_ARTIFACT", `Plugin package path escapes its store: ${candidate}`);
    }
}

function sameTargets(left: string[], right: readonly string[]) {
    return left.length === right.length && left.every((target) => right.includes(target));
}
