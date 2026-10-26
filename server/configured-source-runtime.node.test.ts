import { it, vi, expect, describe, afterEach } from "vitest";

import { createSourceMetadataResponse } from "../shared/source-metadata";
import { createConfiguredSourceRuntime } from "./configured-source-runtime.node";
import {
    clearRuntimeSourceCatalog,
    registerRuntimeSourceCatalog,
    createRuntimeSourceMetadataItem,
} from "../shared/runtime-source-catalog";

import type { SourceID } from "../shared/types";

const manifest = JSON.stringify({
    version: 1,
    sources: [
        {
            key: "rss-feed",
            name: "Example RSS",
            type: "rss",
            endpoint: "https://feeds.example.test/rss.xml",
            intervalMs: 300_000,
            column: "tech",
        },
        {
            key: "json-feed",
            name: "Example JSON",
            type: "json",
            endpoint: "https://api.example.test/news",
            intervalMs: 300_000,
            mapping: {
                itemsPath: "data.items",
                titlePath: "entry.headline",
                urlPath: "entry.url",
                idPath: "entry.id",
                publishedAtPath: "entry.publishedAt",
                mobileUrlPath: "entry.mobileUrl",
            },
        },
        {
            key: "disabled-feed",
            name: "Disabled feed",
            type: "rss",
            endpoint: "https://feeds.example.test/disabled.xml",
            intervalMs: 300_000,
            enabled: false,
        },
    ],
});

const rssFixture = `
    <rss version="2.0"><channel><title>Fixture feed</title><item>
        <guid>rss-1</guid><title>Fixture RSS item</title>
        <link>https://publisher.example.test/story/1</link>
        <pubDate>Mon, 08 Jun 2026 09:00:00 GMT</pubDate>
    </item><item><guid>rss-bad</guid><title>Unsafe link</title>
        <link>javascript:alert(1)</link>
    </item></channel></rss>
`;

const jsonFixture = JSON.stringify({
    data: {
        items: [
            {
                entry: {
                    id: "json-1",
                    headline: "Fixture JSON item",
                    url: "https://publisher.example.test/story/2",
                    mobileUrl: "https://m.publisher.example.test/story/2",
                    publishedAt: "2026-06-08T10:00:00.000Z",
                },
            },
            { entry: { id: "unsafe", headline: "Unsafe scheme", url: "javascript:alert(1)" } },
            { entry: { id: "relative", headline: "Relative URL", url: "/news/relative" } },
            {
                entry: {
                    id: "too-long",
                    headline: "x".repeat(1_001),
                    url: "https://publisher.example.test/story/too-long",
                },
            },
        ],
    },
});

describe("configured source runtime", () => {
    afterEach(() => clearRuntimeSourceCatalog());

    it("registers enabled RSS and JSON sources and maps local fixture responses", async () => {
        const request = vi.fn(async (url: URL, address: string) => {
            expect(address).toBe("93.184.216.34");
            return {
                status: 200,
                headers: {},
                body: url.pathname === "/rss.xml" ? rssFixture : jsonFixture,
            };
        });
        const runtime = createConfiguredSourceRuntime(manifest, "feeds.example.test,api.example.test", {
            resolveIpv4: async () => "93.184.216.34",
            request,
        });

        expect(runtime.listSources()).toEqual([
            expect.objectContaining({
                id: "ext.config.rss-feed",
                name: "Example RSS",
                interval: 300_000,
                column: "tech",
            }),
            expect.objectContaining({
                id: "ext.config.json-feed",
                name: "Example JSON",
                interval: 300_000,
            }),
        ]);
        expect(runtime.hasSource("ext.config.rss-feed")).toBe(true);
        expect(runtime.hasSource("ext.config.disabled-feed")).toBe(false);
        await expect(runtime.fetchSource("ext.config.rss-feed" as SourceID)).resolves.toEqual([
            {
                id: "rss-1",
                title: "Fixture RSS item",
                url: "https://publisher.example.test/story/1",
                pubDate: "Mon, 08 Jun 2026 09:00:00 GMT",
            },
        ]);
        await expect(runtime.fetchSource("ext.config.json-feed" as SourceID)).resolves.toEqual([
            {
                id: "json-1",
                title: "Fixture JSON item",
                url: "https://publisher.example.test/story/2",
                mobileUrl: "https://m.publisher.example.test/story/2",
                pubDate: "2026-06-08T10:00:00.000Z",
            },
            {
                id: "relative",
                title: "Relative URL",
                url: "https://api.example.test/news/relative",
            },
        ]);
        expect(request).toHaveBeenCalledTimes(2);
    });

    it("rejects private DNS results before opening a connection", async () => {
        const request = vi.fn();
        const runtime = createConfiguredSourceRuntime(manifest, "feeds.example.test,api.example.test", {
            resolveIpv4: async () => "127.0.0.1",
            request,
        });

        await expect(runtime.fetchSource("ext.config.rss-feed" as SourceID)).rejects.toThrow("public IPv4 address");
        expect(request).not.toHaveBeenCalled();
    });

    it("publishes configured source descriptions through the shared discovery catalog", () => {
        const runtime = createConfiguredSourceRuntime(manifest, "feeds.example.test,api.example.test", {
            resolveIpv4: async () => "93.184.216.34",
            request: async () => ({ status: 200, headers: {}, body: rssFixture }),
        });

        registerRuntimeSourceCatalog(runtime.listSources().map(createRuntimeSourceMetadataItem));

        expect(
            createSourceMetadataResponse().data.sources.find((source) => source.id === "ext.config.rss-feed")
        ).toMatchObject({
            id: "ext.config.rss-feed",
            name: "Example RSS",
            column: "tech",
            columnName: "科技",
            home: "https://feeds.example.test",
        });
    });

    it("blocks redirects to hosts outside the explicit allowlist", async () => {
        const request = vi.fn(async () => ({
            status: 302,
            headers: { location: "https://internal.example.test/feed" },
            body: "",
        }));
        const runtime = createConfiguredSourceRuntime(manifest, "feeds.example.test,api.example.test", {
            resolveIpv4: async () => "93.184.216.34",
            request,
        });

        await expect(runtime.fetchSource("ext.config.rss-feed" as SourceID)).rejects.toThrow(
            "outside the HTTPS host allowlist"
        );
        expect(request).toHaveBeenCalledTimes(1);
    });

    it("rejects unsafe JSON paths, non-HTTPS endpoints, and unlisted hosts", () => {
        const unsafePath = JSON.parse(manifest) as {
            sources: Array<Record<string, unknown>>;
            version: number;
        };
        const jsonSource = unsafePath.sources[1]!;
        const mapping = jsonSource.mapping as Record<string, unknown>;
        mapping.itemsPath = "__proto__.items";
        expect(() =>
            createConfiguredSourceRuntime(JSON.stringify(unsafePath), "feeds.example.test,api.example.test")
        ).toThrow("invalid shape or value");

        const insecureEndpoint = manifest.replace(
            "https://feeds.example.test/rss.xml",
            "http://feeds.example.test/rss.xml"
        );
        expect(() => createConfiguredSourceRuntime(insecureEndpoint, "feeds.example.test,api.example.test")).toThrow(
            "HTTPS host allowlist"
        );

        expect(() => createConfiguredSourceRuntime(manifest, "other.example.test")).toThrow("HTTPS host allowlist");
    });

    it("limits manifest size and rejects malformed responses", async () => {
        expect(() => createConfiguredSourceRuntime(" ".repeat(128 * 1024 + 1), "feeds.example.test")).toThrow(
            "128 KiB"
        );

        const runtime = createConfiguredSourceRuntime(manifest, "feeds.example.test,api.example.test", {
            resolveIpv4: async () => "93.184.216.34",
            request: async () => ({ status: 200, headers: {}, body: JSON.stringify({ data: { items: {} } }) }),
        });
        await expect(runtime.fetchSource("ext.config.json-feed" as SourceID)).rejects.toThrow(
            "itemsPath did not resolve to an array"
        );
    });
});
