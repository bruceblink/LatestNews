import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { sep, join, dirname, resolve, basename, relative, isAbsolute } from "node:path";
import { rm, stat, mkdir, rename, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";

import { CrawlerPlatformError } from "./core/errors";
import { createNodeCrawlerHost } from "./host/node-host";
import { parseCrawlerPluginCatalog } from "./sdk/catalog";
import { parseCrawlerPluginManifest } from "./sdk/manifest";
import { bundleCrawlerPlugin } from "./testing/bundle-plugin";
import { crawlerTestFixturesSchema } from "./testing/fixtures";
import { createCrawlerPluginArtifact } from "./host/plugin-package";
import {
    pinCrawlerPluginVersion,
    setCrawlerPluginEnabled,
    unpinCrawlerPluginVersion,
    installCrawlerPluginPackage,
    listInstalledCrawlerPlugins,
    rollbackCrawlerPluginVersion,
    selectLatestCrawlerPluginVersion,
} from "./host/plugin-store";

import type { CrawlerPluginManifest } from "./sdk/manifest";
import type { CrawlerTestFixtures } from "./testing/fixtures";
import type { CrawlerContext, CrawlerHttpRequest, CrawlerHttpResponse } from "./sdk/types";

const manifestFilename = "manifest.json";
const testFixturesFilename = "test-fixtures.json";
const maxFixtureBodyBytes = 2 * 1024 * 1024;
const maxCatalogBytes = 1024 * 1024;

interface ValidatedPluginDirectory {
    root: string;
    entryPath: string;
    manifest: CrawlerPluginManifest;
}

/** Validate plugin metadata and paths without importing or executing plugin code. */
export async function validatePluginDirectory(pluginDirectory: string): Promise<ValidatedPluginDirectory> {
    const root = await realpath(resolve(pluginDirectory));
    const manifestPath = await resolvePluginFile(root, manifestFilename);
    const rawManifest: unknown = JSON.parse(await readFile(manifestPath, "utf8"));
    const manifest = parseCrawlerPluginManifest(rawManifest);
    const entryPath = await resolvePluginFile(root, manifest.entry);
    const entryStat = await stat(entryPath);
    if (!entryStat.isFile()) {
        throw new CrawlerPlatformError("INVALID_MANIFEST", `Plugin entry ${manifest.entry} is not a file.`);
    }

    return { root, entryPath, manifest };
}

/** Build a self-contained plugin directory atomically and refuse to replace existing output. */
export async function bundlePluginPackage(pluginDirectory: string, outputDirectory: string) {
    const plugin = await validatePluginDirectory(pluginDirectory);
    const outputPath = resolve(outputDirectory);
    assertOutputOutsidePlugin(plugin.root, outputPath);
    if (await pathExists(outputPath)) {
        throw new Error(`Output path already exists: ${outputPath}`);
    }

    const outputParent = dirname(outputPath);
    await mkdir(outputParent, { recursive: true });
    const stageDirectory = await mkdtemp(join(outputParent, `.${basename(outputPath)}.staging-`));
    try {
        await bundleCrawlerPlugin(plugin.entryPath, stageDirectory);
        const bundledEntryPath = join(stageDirectory, "plugin.mjs");
        if (!(await stat(bundledEntryPath)).isFile()) {
            throw new Error("Plugin bundler did not produce plugin.mjs.");
        }

        const packagedManifest = { ...plugin.manifest, entry: "plugin.mjs" };
        const manifestText = `${JSON.stringify(packagedManifest, null, 2)}\n`;
        const pluginBytes = await readFile(bundledEntryPath);
        await writeFile(join(stageDirectory, manifestFilename), manifestText, "utf8");
        await writeFile(
            join(stageDirectory, "artifact.json"),
            `${JSON.stringify(createCrawlerPluginArtifact(packagedManifest, manifestText, pluginBytes), null, 2)}\n`,
            "utf8"
        );
        await rename(stageDirectory, outputPath);
        return { outputPath, manifest: packagedManifest };
    } finally {
        if (await pathExists(stageDirectory)) await rm(stageDirectory, { recursive: true, force: true });
    }
}

/** Run each declared fixture case in a bounded Node worker with all network replies replayed locally. */
export async function runPluginFixtureTests(pluginDirectory: string) {
    const plugin = await validatePluginDirectory(pluginDirectory);
    if (!plugin.manifest.targets.includes("node")) {
        throw new CrawlerPlatformError(
            "TARGET_UNSUPPORTED",
            `Plugin ${plugin.manifest.id} does not support the node host.`
        );
    }

    const fixturePath = await resolvePluginFile(plugin.root, testFixturesFilename);
    const rawFixtures: unknown = JSON.parse(await readFile(fixturePath, "utf8"));
    const fixtures = crawlerTestFixturesSchema.parse(rawFixtures);
    const responses = await resolveFixtureResponses(plugin.root, plugin.manifest, fixtures);
    for (const testCase of fixtures.cases) {
        if (!plugin.manifest.sources.some((source) => source.id === testCase.sourceId)) {
            throw new CrawlerPlatformError(
                "INVALID_MANIFEST",
                `Test case references undeclared source ${testCase.sourceId}.`
            );
        }
    }

    const stageDirectory = await mkdtemp(join(tmpdir(), "latestnews-crawler-test-"));
    try {
        await bundleCrawlerPlugin(plugin.entryPath, stageDirectory);
        const host = createNodeCrawlerHost({
            timeoutMs: 10000,
            requestHandler: async (request) => findFixtureResponse(responses, request),
        });
        const now = fixtures.now ? Date.parse(fixtures.now) : Date.now();
        for (const [index, testCase] of fixtures.cases.entries()) {
            const actual = await host.collect({
                manifest: plugin.manifest,
                entryPath: join(stageDirectory, "plugin.mjs"),
                sourceId: testCase.sourceId,
                ...(testCase.parameters !== undefined ? { parameters: testCase.parameters } : {}),
                context: createHostContext(now),
            });
            assert.equal(actual.length, testCase.expectedItems.length, `Case ${index + 1} item count differs.`);
            for (const [itemIndex, expected] of testCase.expectedItems.entries()) {
                for (const [key, value] of Object.entries(expected)) {
                    assert.deepEqual(
                        actual[itemIndex]?.[key as keyof (typeof actual)[number]],
                        value,
                        `Case ${index + 1}, item ${itemIndex + 1}, field ${key} differs.`
                    );
                }
            }
        }
        return { pluginId: plugin.manifest.id, casesPassed: fixtures.cases.length };
    } finally {
        await rm(stageDirectory, { recursive: true, force: true });
    }
}

/** Parse a small CLI grammar and return nonzero for invalid input or failed plugin checks. */
export async function runCrawlerCli(args: string[]) {
    try {
        const [command, ...commandArgs] = args;
        if (!command) return printUsage();

        if (command === "catalog" && commandArgs[0] === "validate") {
            if (commandArgs.length !== 2) return printUsage();
            const catalog = await readPluginCatalog(commandArgs[1]!);
            const validated: Array<{ id: string; version: string }> = [];
            for (const plugin of catalog.data.plugins) {
                for (const version of plugin.versions) {
                    await resolveCatalogPluginSource(catalog.path, plugin, version.version);
                    validated.push({ id: plugin.id, version: version.version });
                }
            }
            process.stdout.write(`${JSON.stringify({ result: "valid", plugins: validated })}\n`);
            return 0;
        }

        if (command === "list") {
            const options = parseStoreOptions(commandArgs, { allowEnable: false, allowVersion: false });
            if (options.positionals.length !== 0) return printUsage();
            process.stdout.write(`${JSON.stringify(listInstalledCrawlerPlugins(options.root))}\n`);
            return 0;
        }

        if (command === "install" || command === "update") {
            const options = parseStoreOptions(commandArgs, { allowEnable: true, allowVersion: true });
            if (options.positionals.length !== 2) return printUsage();
            const [catalogPath, pluginId] = options.positionals;
            const catalog = await readPluginCatalog(catalogPath!);
            const plugin = catalog.data.plugins.find((entry) => entry.id === pluginId);
            if (!plugin) throw new Error(`Plugin ${pluginId} is not present in the catalog.`);
            const version =
                options.version ?? selectLatestCrawlerPluginVersion(plugin.versions.map((entry) => entry.version));
            const sourceDirectory = await resolveCatalogPluginSource(catalog.path, plugin, version);
            const stagingDirectory = await mkdtemp(join(tmpdir(), "latestnews-crawler-install-"));
            try {
                const outputDirectory = join(stagingDirectory, "bundle");
                const bundle = await bundlePluginPackage(sourceDirectory, outputDirectory);
                const result = await installCrawlerPluginPackage(bundle.outputPath, options.root, {
                    action: command,
                    enable: options.enable,
                });
                process.stdout.write(
                    `${JSON.stringify({ result: command === "install" ? "installed" : "updated", ...result })}\n`
                );
            } finally {
                await rm(stagingDirectory, { recursive: true, force: true });
            }
            return 0;
        }

        if (["enable", "disable", "pin", "unpin", "rollback"].includes(command)) {
            const options = parseStoreOptions(commandArgs, { allowEnable: false, allowVersion: false });
            if (options.positionals.length !== 1) return printUsage();
            const [pluginId] = options.positionals;
            if (command === "enable" || command === "disable") {
                const enabledPluginIds = await setCrawlerPluginEnabled(options.root, pluginId!, command === "enable");
                process.stdout.write(`${JSON.stringify({ result: command, pluginId, enabledPluginIds })}\n`);
                return 0;
            }
            if (command === "pin") {
                const version = await pinCrawlerPluginVersion(options.root, pluginId!);
                process.stdout.write(`${JSON.stringify({ result: "pinned", pluginId, version })}\n`);
                return 0;
            }
            if (command === "unpin") {
                await unpinCrawlerPluginVersion(options.root, pluginId!);
                process.stdout.write(`${JSON.stringify({ result: "unpinned", pluginId })}\n`);
                return 0;
            }
            const version = await rollbackCrawlerPluginVersion(options.root, pluginId!);
            process.stdout.write(`${JSON.stringify({ result: "rolled-back", pluginId, version })}\n`);
            return 0;
        }

        const [pluginDirectory, ...options] = commandArgs;
        if (!pluginDirectory) return printUsage();

        if (command === "validate") {
            const plugin = await validatePluginDirectory(pluginDirectory);
            process.stdout.write(
                `${JSON.stringify({ result: "valid", id: plugin.manifest.id, name: plugin.manifest.name })}\n`
            );
            return 0;
        }

        if (command === "test") {
            const result = await runPluginFixtureTests(pluginDirectory);
            process.stdout.write(`${JSON.stringify({ result: "passed", ...result })}\n`);
            return 0;
        }

        if (command === "bundle") {
            const outputIndex = options.indexOf("--out");
            const outputDirectory = outputIndex >= 0 ? options[outputIndex + 1] : undefined;
            if (!outputDirectory || options.length !== 2 || outputIndex !== 0) return printUsage();
            const result = await bundlePluginPackage(pluginDirectory, outputDirectory);
            process.stdout.write(
                `${JSON.stringify({ result: "built", output: result.outputPath, id: result.manifest.id })}\n`
            );
            return 0;
        }

        return printUsage();
    } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        return 1;
    }
}

async function resolvePluginFile(root: string, relativePath: string) {
    if (!isSafeRelativePath(relativePath)) {
        throw new CrawlerPlatformError("INVALID_MANIFEST", `Unsafe plugin-relative path ${relativePath}.`);
    }
    const path = await realpath(resolve(root, ...relativePath.split("/")));
    assertPathWithin(root, path);
    return path;
}

async function readPluginCatalog(catalogPath: string) {
    const path = await realpath(resolve(catalogPath));
    const catalogStat = await stat(path);
    if (!catalogStat.isFile() || catalogStat.size > maxCatalogBytes) {
        throw new CrawlerPlatformError("INVALID_MANIFEST", `Catalog exceeds the ${maxCatalogBytes}-byte limit.`);
    }
    const rawCatalog: unknown = JSON.parse(await readFile(path, "utf8"));
    return { path, data: parseCrawlerPluginCatalog(rawCatalog) };
}

async function resolveCatalogPluginSource(
    catalogPath: string,
    plugin: { id: string; name: string; versions: Array<{ version: string; sourcePath: string }> },
    version: string
) {
    const versionEntry = plugin.versions.find((entry) => entry.version === version);
    if (!versionEntry) throw new Error(`Plugin ${plugin.id} version ${version} is not present in the catalog.`);
    const catalogRoot = dirname(catalogPath);
    const sourceDirectory = await realpath(resolve(catalogRoot, ...versionEntry.sourcePath.split("/")));
    assertPathWithin(catalogRoot, sourceDirectory);
    const validated = await validatePluginDirectory(sourceDirectory);
    if (
        validated.manifest.id !== plugin.id ||
        validated.manifest.name !== plugin.name ||
        validated.manifest.version !== version
    ) {
        throw new CrawlerPlatformError(
            "INVALID_MANIFEST",
            `Catalog entry ${plugin.id}@${version} does not match its plugin manifest.`
        );
    }
    return sourceDirectory;
}

function parseStoreOptions(
    args: string[],
    { allowEnable, allowVersion }: { allowEnable: boolean; allowVersion: boolean }
) {
    const positionals: string[] = [];
    let root: string | undefined;
    let version: string | undefined;
    let enable = false;
    for (let index = 0; index < args.length; index += 1) {
        const argument = args[index]!;
        if (argument === "--root") {
            if (root || !args[index + 1] || args[index + 1]!.startsWith("--"))
                throw new Error("--root requires one path.");
            root = args[++index];
        } else if (argument === "--version" && allowVersion) {
            if (version || !args[index + 1] || args[index + 1]!.startsWith("--")) {
                throw new Error("--version requires one version.");
            }
            version = args[++index];
        } else if (argument === "--enable" && allowEnable) {
            if (enable) throw new Error("--enable can only appear once.");
            enable = true;
        } else if (argument.startsWith("--")) {
            throw new Error(`Unknown option ${argument}.`);
        } else {
            positionals.push(argument);
        }
    }
    if (!root) throw new Error("A plugin store path is required with --root.");
    return { positionals, root: resolve(root), ...(version ? { version } : {}), enable };
}

function isSafeRelativePath(path: string) {
    return (
        path.length > 0 &&
        !isAbsolute(path) &&
        !path.includes("\\") &&
        !path.includes(":") &&
        !path.includes("\0") &&
        path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..")
    );
}

function assertPathWithin(root: string, candidate: string) {
    const relativePath = relative(root, candidate);
    if (!relativePath || relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
        throw new CrawlerPlatformError(
            "INVALID_MANIFEST",
            `Resolved path must remain below plugin directory: ${candidate}`
        );
    }
}

function assertOutputOutsidePlugin(pluginRoot: string, outputPath: string) {
    const relativePath = relative(pluginRoot, outputPath);
    if (!relativePath.startsWith(`..${sep}`) && relativePath !== ".." && !isAbsolute(relativePath)) {
        throw new Error("Plugin output must be outside the plugin source directory.");
    }
}

async function resolveFixtureResponses(
    root: string,
    manifest: CrawlerPluginManifest,
    fixtures: CrawlerTestFixtures
): Promise<Record<string, CrawlerHttpResponse>> {
    const responses: Record<string, CrawlerHttpResponse> = {};
    let totalBytes = 0;
    for (const [url, fixture] of Object.entries(fixtures.responses)) {
        const parsedUrl = new URL(url);
        const permitted = manifest.permissions.network.some((permission) => permission.origin === parsedUrl.origin);
        if (parsedUrl.protocol !== "https:" || !permitted) {
            throw new CrawlerPlatformError(
                "INVALID_MANIFEST",
                `Fixture URL is not covered by HTTPS permission: ${url}`
            );
        }

        const body =
            fixture.bodyFile !== undefined
                ? await readFile(await resolvePluginFile(root, fixture.bodyFile), "utf8")
                : fixture.body;
        if (body === undefined)
            throw new CrawlerPlatformError("INVALID_MANIFEST", `Fixture response ${url} has no body.`);
        totalBytes += Buffer.byteLength(body);
        if (Buffer.byteLength(body) > maxFixtureBodyBytes || totalBytes > 8 * 1024 * 1024) {
            throw new CrawlerPlatformError(
                "INVALID_MANIFEST",
                "Fixture response bodies exceed the configured size limit."
            );
        }
        responses[url] = { status: fixture.status, headers: fixture.headers, body };
    }
    return responses;
}

function findFixtureResponse(responses: Record<string, CrawlerHttpResponse>, request: CrawlerHttpRequest) {
    const response = responses[request.url];
    if (!response) throw new Error(`No test response was recorded for ${request.method ?? "GET"} ${request.url}.`);
    return response;
}

function createHostContext(now: number): CrawlerContext {
    return {
        signal: new AbortController().signal,
        now: () => now,
        http: {
            request: async () => {
                throw new Error("The plugin test runner must broker requests through the host.");
            },
        },
    };
}

async function pathExists(path: string) {
    try {
        await stat(path);
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw error;
    }
}

function printUsage() {
    process.stderr.write(
        [
            "Usage:",
            "  pnpm crawler validate <plugin-directory>",
            "  pnpm crawler test <plugin-directory>",
            "  pnpm crawler bundle <plugin-directory> --out <output-directory>",
            "  pnpm crawler catalog validate <catalog.json>",
            "  pnpm crawler install <catalog.json> <plugin-id> --root <store> [--version <version>] [--enable]",
            "  pnpm crawler update <catalog.json> <plugin-id> --root <store> [--version <version>]",
            "  pnpm crawler list --root <store>",
            "  pnpm crawler enable|disable|pin|unpin|rollback <plugin-id> --root <store>",
        ].join("\n") + "\n"
    );
    return 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    void runCrawlerCli(process.argv.slice(2)).then((exitCode) => {
        process.exitCode = exitCode;
    });
}
