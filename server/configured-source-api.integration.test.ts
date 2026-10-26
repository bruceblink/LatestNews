import { createApp } from "h3";
import { it, vi, expect, describe, afterEach } from "vitest";

import sourcesHandler from "./api/v1/sources.get";
import batchHandler from "./api/v1/sources/batch.post";
import sourceDetailHandler from "./api/v1/sources/[id].get";
import sourceItemsHandler from "./api/v1/sources/[id]/items.get";
import { createConfiguredSourceRuntime } from "./configured-source-runtime.node";
import {
    clearRuntimeSourceCatalog,
    registerRuntimeSourceCatalog,
    createRuntimeSourceMetadataItem,
} from "../shared/runtime-source-catalog";

import type { SourceID } from "../shared/types";

type ConfiguredRuntime = ReturnType<typeof createConfiguredSourceRuntime>;

const { runtimeState } = vi.hoisted(() => ({ runtimeState: { current: null as ConfiguredRuntime | null } }));

vi.mock("./utils/source-fetch", () => ({
    hasSourceGetter: (id: string) => runtimeState.current?.hasSource(id as SourceID) ?? false,
    fetchSourceItems: (id: string) => runtimeState.current?.fetchSource(id as SourceID) ?? Promise.resolve([]),
}));

vi.mock("#/utils/crawler-plugin-runtime", () => ({
    initializeCrawlerPluginCatalog: () => runtimeState.current?.listSources() ?? [],
    hasCrawlerPluginSource: (id: string) => runtimeState.current?.hasSource(id as SourceID) ?? false,
    fetchCrawlerPluginSource: (id: string) => runtimeState.current?.fetchSource(id as SourceID),
}));

vi.mock("#/database/cache", () => ({ getCacheTable: async () => undefined }));

const rssFixture = `<rss><channel><title>Fixture RSS</title><item>
    <guid>rss-1</guid><title>RSS API fixture</title><link>https://publisher.example.test/rss/1</link>
    <pubDate>Mon, 08 Jun 2026 09:00:00 GMT</pubDate>
</item></channel></rss>`;

const jsonFixture = JSON.stringify({
    items: [{ id: "json-1", headline: "JSON API fixture", link: "https://publisher.example.test/json/1" }],
});

const manifest = JSON.stringify({
    version: 1,
    sources: [
        {
            key: "rss-feed",
            name: "Configured RSS",
            type: "rss",
            endpoint: "https://feeds.example.test/rss.xml",
            intervalMs: 300_000,
            column: "tech",
        },
        {
            key: "json-feed",
            name: "Configured JSON",
            type: "json",
            endpoint: "https://api.example.test/news",
            intervalMs: 300_000,
            mapping: { itemsPath: "items", titlePath: "headline", urlPath: "link", idPath: "id" },
        },
    ],
});

describe("configured source API integration", () => {
    afterEach(() => {
        runtimeState.current = null;
        clearRuntimeSourceCatalog();
    });

    it("serves configured sources through discovery, detail, single-item, and batch routes", async () => {
        const runtime = createConfiguredSourceRuntime(manifest, "feeds.example.test,api.example.test", {
            resolveIpv4: async () => "93.184.216.34",
            request: async (url) => ({
                status: 200,
                headers: {},
                body: url.pathname === "/rss.xml" ? rssFixture : jsonFixture,
            }),
        });
        runtimeState.current = runtime;
        registerRuntimeSourceCatalog(runtime.listSources().map(createRuntimeSourceMetadataItem));

        const app = createApp();
        app.get("/v1/sources", sourcesHandler);
        app.get("/v1/sources/:id/items", sourceItemsHandler);
        app.get("/v1/sources/:id", sourceDetailHandler);
        app.post("/v1/sources/batch", batchHandler);

        const directoryResponse = await app.request("/v1/sources");
        expect(directoryResponse.status).toBe(200);
        const directory = (await directoryResponse.json()) as { data: { sources: unknown[] } };
        expect(directory.data.sources).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ id: "ext.config.rss-feed", name: "Configured RSS" }),
                expect.objectContaining({ id: "ext.config.json-feed", name: "Configured JSON" }),
            ])
        );

        const detailResponse = await app.request("/v1/sources/ext.config.rss-feed");
        expect(detailResponse.status).toBe(200);
        expect(await detailResponse.json()).toMatchObject({
            data: { id: "ext.config.rss-feed", name: "Configured RSS", column: "tech" },
            meta: { sourceId: "ext.config.rss-feed", canonicalSourceId: "ext.config.rss-feed", redirected: false },
        });

        const itemsResponse = await app.request("/v1/sources/ext.config.rss-feed/items");
        expect(itemsResponse.status).toBe(200);
        expect(await itemsResponse.json()).toMatchObject({
            data: {
                id: "ext.config.rss-feed",
                status: "success",
                items: [
                    expect.objectContaining({ title: "RSS API fixture", url: "https://publisher.example.test/rss/1" }),
                ],
            },
            meta: { sourceId: "ext.config.rss-feed", itemCount: 1 },
        });

        const batchResponse = await app.request("/v1/sources/batch", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ sources: ["ext.config.rss-feed", "ext.config.json-feed"] }),
        });
        expect(batchResponse.status).toBe(200);
        expect(await batchResponse.json()).toMatchObject({
            data: [
                expect.objectContaining({
                    id: "ext.config.rss-feed",
                    items: [expect.objectContaining({ title: "RSS API fixture" })],
                }),
                expect.objectContaining({
                    id: "ext.config.json-feed",
                    items: [expect.objectContaining({ title: "JSON API fixture" })],
                }),
            ],
            meta: { requestedSourceCount: 2, resolvedSourceCount: 2, partial: false, itemCount: 2 },
            errors: [],
        });
    });
});
