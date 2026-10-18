import type { SourceID } from "@shared/types";

import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, expect, describe } from "vitest";
import { rm, mkdtemp, readFile } from "node:fs/promises";

import { generateUrlHashId } from "../server/utils/source";
import { defineCrawlerPlugin } from "../crawler-platform/sdk/plugin";
import { CrawlerPlatformError } from "../crawler-platform/core/errors";
import { normalizeCrawlerItems } from "../crawler-platform/core/output";
import { pcbetaPlugin } from "../crawler-platform/plugins/pcbeta/plugin";
import { CrawlerPluginRegistry } from "../crawler-platform/core/registry";
import { createLegacyUrlHashId } from "../crawler-platform/sdk/legacy-id";
import { createNodeCrawlerHost } from "../crawler-platform/host/node-host";
import { createReplayHttp } from "../crawler-platform/testing/replay-http";
import { rssExamplePlugin } from "../crawler-platform/examples/rss/plugin";
import { htmlExamplePlugin } from "../crawler-platform/examples/html/plugin";
import { jsonExamplePlugin } from "../crawler-platform/examples/json/plugin";
import { parseCrawlerPluginManifest } from "../crawler-platform/sdk/manifest";
import { bundleCrawlerPlugin } from "../crawler-platform/testing/bundle-plugin";
import { createServerCrawlerPluginRuntime } from "../server/crawler-plugin-runtime.node.ts";
import { bundlePluginPackage, runPluginFixtureTests, validatePluginDirectory } from "../crawler-platform/cli";

import type { CrawlerContext, CrawlerHttpResponse } from "../crawler-platform/sdk/types";

const fixtureRoot = join(process.cwd(), "crawler-platform", "examples");

describe("crawler plugin SDK and core", () => {
    it("runs JSON, HTML, and RSS plugins from offline response replay", async () => {
        const registry = new CrawlerPluginRegistry();
        for (const plugin of [jsonExamplePlugin, htmlExamplePlugin, rssExamplePlugin]) registry.register(plugin);

        const [jsonFixture, htmlFixture, rssFixture] = await Promise.all([
            readFile(join(fixtureRoot, "json", "fixture.json"), "utf8"),
            readFile(join(fixtureRoot, "html", "fixture.html"), "utf8"),
            readFile(join(fixtureRoot, "rss", "fixture.xml"), "utf8"),
        ]);

        const jsonItems = await registry.collect(
            "org.latestnews.example-json/latest",
            createContext({ "https://json.example.test/news.json": jsonResponse(jsonFixture) })
        );
        const htmlItems = await registry.collect(
            "org.latestnews.example-html/latest",
            createContext({ "https://html.example.test/news": htmlResponse(htmlFixture) })
        );
        const rssItems = await registry.collect(
            "org.latestnews.example-rss/latest",
            createContext({ "https://rss.example.test/feed.xml": xmlResponse(rssFixture) })
        );

        expect(jsonItems).toEqual([
            {
                id: 901,
                title: "JSON headline",
                url: "https://json.example.test/story/1",
                publishedAt: "2026-10-18T09:00:00Z",
            },
        ]);
        expect(htmlItems).toEqual([
            {
                id: expect.stringMatching(/^org\.latestnews\.example-html\/latest:/),
                title: "HTML headline",
                url: "https://html.example.test/story/2",
                publishedAt: "2026-10-18T08:00:00Z",
            },
        ]);
        expect(rssItems).toEqual([
            {
                id: "rss-1",
                title: "RSS headline",
                url: "https://rss.example.test/story/3",
                publishedAt: "Sun, 18 Oct 2026 07:00:00 GMT",
            },
        ]);
        expect(registry.listSources()).toHaveLength(3);
    });

    it("runs the bundled JSON plugin artifact in the Node process host", async () => {
        const outputDirectory = await mkdtemp(join(tmpdir(), "latestnews-crawler-node-"));
        const entryPath = join(process.cwd(), "crawler-platform", "examples", "json", "plugin.ts");
        const fixture = await readFile(join(fixtureRoot, "json", "fixture.json"), "utf8");
        try {
            await bundleCrawlerPlugin(entryPath, outputDirectory);
            const host = createNodeCrawlerHost({
                timeoutMs: 5000,
                requestHandler: async (request) => {
                    expect(request.url).toBe("https://json.example.test/news.json");
                    return jsonResponse(fixture);
                },
            });
            const items = await host.collect({
                manifest: jsonExamplePlugin.manifest,
                entryPath: join(outputDirectory, "plugin.mjs"),
                sourceId: "latest",
                context: createContext({}),
            });

            expect(items).toEqual([
                {
                    id: 901,
                    title: "JSON headline",
                    url: "https://json.example.test/story/1",
                    publishedAt: "2026-10-18T09:00:00Z",
                },
            ]);
        } finally {
            await rm(outputDirectory, { recursive: true, force: true });
        }
    });

    it("validates, replays fixtures, and packages JSON, HTML, and RSS plugins", async () => {
        const packages = [
            { directory: join(fixtureRoot, "json"), manifest: jsonExamplePlugin.manifest },
            { directory: join(fixtureRoot, "html"), manifest: htmlExamplePlugin.manifest },
            { directory: join(fixtureRoot, "rss"), manifest: rssExamplePlugin.manifest },
            {
                directory: join(process.cwd(), "crawler-platform", "plugins", "pcbeta"),
                manifest: pcbetaPlugin.manifest,
            },
        ];
        for (const { directory: pluginDirectory, manifest: implementationManifest } of packages) {
            const plugin = await validatePluginDirectory(pluginDirectory);
            const manifestFile = JSON.parse(await readFile(join(pluginDirectory, "manifest.json"), "utf8"));
            const fixtureResult = await runPluginFixtureTests(pluginDirectory);

            expect(implementationManifest).toEqual({ ...manifestFile, entry: "plugin.mjs" });
            expect(manifestFile.entry).toBe("plugin.ts");
            expect(fixtureResult).toEqual({
                pluginId: plugin.manifest.id,
                casesPassed: 1,
            });
        }

        const outputParent = await mkdtemp(join(tmpdir(), "latestnews-crawler-package-"));
        const outputDirectory = join(outputParent, "json-plugin");
        try {
            const result = await bundlePluginPackage(join(fixtureRoot, "json"), outputDirectory);
            const packagedManifest = JSON.parse(await readFile(join(outputDirectory, "manifest.json"), "utf8"));
            const artifact = JSON.parse(await readFile(join(outputDirectory, "artifact.json"), "utf8"));

            expect(result.outputPath).toBe(outputDirectory);
            expect(packagedManifest.entry).toBe("plugin.mjs");
            expect(artifact).toMatchObject({
                artifactVersion: 1,
                pluginId: "org.latestnews.example-json",
                pluginVersion: "0.1.0",
                targets: ["node", "electron"],
            });
            expect(artifact.pluginSha256).toMatch(/^[a-f0-9]{64}$/);
            await expect(bundlePluginPackage(join(fixtureRoot, "json"), outputDirectory)).rejects.toThrow(
                "Output path already exists"
            );
        } finally {
            await rm(outputParent, { recursive: true, force: true });
        }
    });

    it("keeps an existing source ID and URL hash when a Node plugin replaces its getter", async () => {
        const sourceDirectory = join(process.cwd(), "crawler-platform", "plugins", "pcbeta");
        const outputParent = await mkdtemp(join(tmpdir(), "latestnews-crawler-node-provider-"));
        const packageDirectory = join(outputParent, "org.latestnews.pcbeta");
        const fixture = await readFile(join(sourceDirectory, "fixture.xml"), "utf8");
        const feedUrl = "https://bbs.pcbeta.com/forum.php?mod=rss&fid=563&auth=0";
        const itemUrl = "https://bbs.pcbeta.com/topic/1";
        try {
            await bundlePluginPackage(sourceDirectory, packageDirectory);
            const runtime = createServerCrawlerPluginRuntime({
                pluginDirectory: outputParent,
                enabledPluginIds: ["org.latestnews.pcbeta"],
                acceptedSourceIds: new Set(["pcbeta-windows11"]),
                workerPath: join(process.cwd(), "crawler-platform", "runtime", "worker-entry.mjs"),
                requestHandler: async (request) => {
                    expect(request.url).toBe(feedUrl);
                    expect(request.method ?? "GET").toBe("GET");
                    return { status: 200, headers: { "content-type": "application/rss+xml" }, body: fixture };
                },
            });
            const items = await runtime.fetchSource("pcbeta-windows11");
            const expectedId = await generateUrlHashId(itemUrl);

            expect(runtime.hasSource("pcbeta-windows11")).toBe(true);
            expect(runtime.listSourceIds()).toEqual(["pcbeta-windows11"]);
            expect(await createLegacyUrlHashId(itemUrl)).toBe(expectedId);
            expect(items).toEqual([
                {
                    id: expectedId,
                    title: "Windows fixture headline",
                    url: itemUrl,
                    pubDate: "Sun, 18 Oct 2026 07:00:00 GMT",
                },
            ]);
            expect(await runtime.fetchSource("unknown-source" as SourceID)).toBeUndefined();
        } finally {
            await rm(outputParent, { recursive: true, force: true });
        }
    });

    it("rejects unsafe manifests before registration", () => {
        expect(() =>
            parseCrawlerPluginManifest({
                ...jsonExamplePlugin.manifest,
                entry: "../escape.mjs",
            })
        ).toThrowError(CrawlerPlatformError);
        expect(() =>
            parseCrawlerPluginManifest({
                ...jsonExamplePlugin.manifest,
                permissions: { network: [{ origin: "https://json.example.test/private", methods: ["GET"] }] },
            })
        ).toThrowError(CrawlerPlatformError);
    });

    it("rejects duplicate plugin IDs and requests outside declared origins", async () => {
        const registry = new CrawlerPluginRegistry();
        registry.register(jsonExamplePlugin);
        expect(() => registry.register(jsonExamplePlugin)).toThrowError(CrawlerPlatformError);

        const manifest = {
            ...jsonExamplePlugin.manifest,
            id: "org.latestnews.example-denied",
        };
        const deniedPlugin = defineCrawlerPlugin(manifest, {
            async collect(context) {
                return context.http.request({ url: "https://outside.example.test/news.json" });
            },
        });
        registry.register(deniedPlugin);

        await expect(registry.collect("org.latestnews.example-denied/latest", createContext({}))).rejects.toMatchObject(
            { code: "NETWORK_PERMISSION_DENIED" }
        );
    });

    it("rejects a plugin from a host it does not declare", async () => {
        const host = createNodeCrawlerHost();
        await expect(
            Promise.resolve().then(() =>
                host.collect({
                    manifest: { ...jsonExamplePlugin.manifest, targets: ["electron"] },
                    entryPath: "unused.mjs",
                    sourceId: "latest",
                    context: createContext({}),
                })
            )
        ).rejects.toMatchObject({ code: "TARGET_UNSUPPORTED" });
    });

    it("deduplicates canonical URLs and enforces output limits", () => {
        const sourceKey = "org.latestnews.example-json/latest" as const;
        expect(
            normalizeCrawlerItems(
                [
                    { title: "First", url: "https://news.example.test/a?utm_source=x" },
                    { title: "Duplicate", url: "https://news.example.test/a#comments" },
                ],
                { sourceKey }
            )
        ).toHaveLength(1);

        expect(() => normalizeCrawlerItems([{ title: "Bad", url: "javascript:alert(1)" }], { sourceKey })).toThrowError(
            CrawlerPlatformError
        );
        expect(() =>
            normalizeCrawlerItems([{ title: "Large ".repeat(20), url: "https://news.example.test/" }], {
                sourceKey,
                maxBytes: 16,
            })
        ).toThrowError(/exceeds the 16-byte limit/);
    });
});

function createContext(fixtures: Readonly<Record<string, CrawlerHttpResponse>>): CrawlerContext {
    const replay = createReplayHttp(fixtures);
    return {
        signal: new AbortController().signal,
        now: () => Date.UTC(2026, 9, 18),
        http: { request: replay.request },
    };
}

function jsonResponse(body: string): CrawlerHttpResponse {
    return { status: 200, headers: { "content-type": "application/json" }, body };
}

function htmlResponse(body: string): CrawlerHttpResponse {
    return { status: 200, headers: { "content-type": "text/html" }, body };
}

function xmlResponse(body: string): CrawlerHttpResponse {
    return { status: 200, headers: { "content-type": "application/rss+xml" }, body };
}
