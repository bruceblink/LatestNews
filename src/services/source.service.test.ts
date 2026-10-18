import { it, vi, expect, describe, afterEach } from "vitest";

import { sourceApi } from "../../shared/source-api";
import { createDynamicSourceId } from "../../shared/dynamic-source-id";
import { fetchSource, fetchSourceBatchV1, fetchSourceItemsV1, fetchEntireSourcesEnvelope } from "./source.service";
import {
    clearRuntimeSourceCatalog,
    registerRuntimeSourceCatalog,
    createRuntimeSourceMetadataItem,
} from "../../shared/runtime-source-catalog";

import type { SourceID, SourceResponse } from "../../shared/types";

const { mockMyFetch } = vi.hoisted(() => ({ mockMyFetch: vi.fn() }));

vi.mock("~/utils", () => ({ myFetch: mockMyFetch }));

const remoteSource = createSource("hackernews", "Remote headline", "remote-1");
const localSource = createSource("pcbeta-windows11", "Local headline", "local-1");
const dynamicSourceId = createDynamicSourceId("org.latestnews.desktop-test", "latest");

describe("desktop local crawler routing", () => {
    afterEach(() => {
        mockMyFetch.mockReset();
        vi.unstubAllGlobals();
        clearRuntimeSourceCatalog();
    });

    it("uses an enabled local source for the single-source endpoint", async () => {
        const bridge = createDesktopBridge(["hackernews"], { hackernews: remoteSource });
        vi.stubGlobal("window", { latestNewsDesktop: bridge });

        await expect(fetchSource({ id: "hackernews", latest: true })).resolves.toEqual(remoteSource);
        expect(bridge.fetchCrawlerSource).toHaveBeenCalledWith("hackernews");
        expect(mockMyFetch).not.toHaveBeenCalled();
    });

    it("falls back to the remote API when no desktop plugin is enabled", async () => {
        const bridge = createDesktopBridge([], {});
        vi.stubGlobal("window", { latestNewsDesktop: bridge });
        mockMyFetch.mockResolvedValue(remoteSource);

        await expect(fetchSource({ id: "hackernews" }, { Authorization: "Bearer remote-token" })).resolves.toEqual(
            remoteSource
        );
        expect(mockMyFetch).toHaveBeenCalledWith(sourceApi.single, {
            query: { id: "hackernews" },
            headers: { Authorization: "Bearer remote-token" },
        });
    });

    it("applies the source-items filters to local plugin results", async () => {
        const source = createSource("hackernews", "Local headline", "local-1", [
            { id: "new", title: "New item", url: "https://local.example.test/new", pubDate: 300 },
            { id: "old", title: "Old item", url: "https://local.example.test/old", pubDate: 100 },
        ]);
        const bridge = createDesktopBridge(["hackernews"], { hackernews: source });
        vi.stubGlobal("window", { latestNewsDesktop: bridge });

        const response = await fetchSourceItemsV1("hackernews", { since: 200, limit: 1 });

        expect(response.data.items).toEqual([source.items[0]]);
        expect(response.meta).toMatchObject({
            sourceId: "hackernews",
            status: "success",
            itemCount: 1,
            unfilteredItemCount: 2,
            since: 200,
            limit: 1,
        });
        expect(mockMyFetch).not.toHaveBeenCalled();
    });

    it("merges local and remote source responses for the entire-source endpoint", async () => {
        const bridge = createDesktopBridge(["pcbeta-windows11"], { "pcbeta-windows11": localSource });
        vi.stubGlobal("window", { latestNewsDesktop: bridge });
        mockMyFetch.mockResolvedValue({
            data: [remoteSource],
            meta: {
                generatedAt: 10,
                requestedSourceCount: 1,
                resolvedSourceCount: 1,
                partial: false,
                omittedSourceIds: [],
            },
            errors: [],
        });

        const response = await fetchEntireSourcesEnvelope(["hackernews", "pcbeta-windows11"]);

        expect(response).toMatchObject({
            data: [remoteSource, localSource],
            meta: { requestedSourceCount: 2, resolvedSourceCount: 2, partial: false, omittedSourceIds: [] },
        });
        expect(mockMyFetch).toHaveBeenCalledWith(sourceApi.entire, {
            method: "POST",
            body: { sources: ["hackernews"] },
        });
    });

    it("applies normal feed filters after merging local and remote sources", async () => {
        const bridge = createDesktopBridge(["pcbeta-windows11"], { "pcbeta-windows11": localSource });
        vi.stubGlobal("window", { latestNewsDesktop: bridge });
        mockMyFetch.mockResolvedValue({
            data: [remoteSource],
            meta: {
                generatedAt: 10,
                requestedSourceCount: 1,
                resolvedSourceCount: 1,
                partial: false,
                omittedSourceIds: [],
            },
            errors: [],
        });

        const response = await fetchSourceBatchV1({ sources: ["hackernews", "pcbeta-windows11"], limit: 1 });

        expect(response.data).toEqual([
            { ...remoteSource, items: [remoteSource.items[0]] },
            { ...localSource, items: [localSource.items[0]] },
        ]);
        expect(response.meta.filters).toEqual({
            sourceIds: ["hackernews", "pcbeta-windows11"],
            columns: [],
            types: [],
            limit: 1,
        });
    });

    it("routes a registered dynamic source to the desktop host and keeps static sources remote", async () => {
        registerRuntimeSourceCatalog([
            createRuntimeSourceMetadataItem({ id: dynamicSourceId, name: "Desktop Dynamic", interval: 300_000 }),
        ]);
        const dynamicSource = createSource(dynamicSourceId, "Local dynamic headline", "dynamic-1");
        const bridge = createDesktopBridge([dynamicSourceId], { [dynamicSourceId]: dynamicSource });
        vi.stubGlobal("window", { latestNewsDesktop: bridge });
        mockMyFetch.mockResolvedValue({
            data: [remoteSource],
            meta: {
                generatedAt: 10,
                requestedSourceCount: 1,
                resolvedSourceCount: 1,
                partial: false,
                omittedSourceIds: [],
            },
            errors: [],
        });

        const response = await fetchSourceBatchV1({ sources: ["hackernews", dynamicSourceId] });

        expect(response.data.map((source) => source.id)).toEqual(["hackernews", dynamicSourceId]);
        expect(bridge.fetchCrawlerSource).toHaveBeenCalledWith(dynamicSourceId);
        expect(mockMyFetch).toHaveBeenCalledWith(sourceApi.entire, {
            method: "POST",
            body: { sources: ["hackernews"] },
        });
    });

    it("falls back to the remote API when a local dynamic source fails", async () => {
        registerRuntimeSourceCatalog([
            createRuntimeSourceMetadataItem({ id: dynamicSourceId, name: "Desktop Dynamic", interval: 300_000 }),
        ]);
        const dynamicSource = createSource(dynamicSourceId, "Remote fallback headline", "fallback-1");
        const bridge = createDesktopBridge([dynamicSourceId], {});
        vi.stubGlobal("window", { latestNewsDesktop: bridge });
        mockMyFetch.mockResolvedValue(dynamicSource);

        await expect(fetchSource({ id: dynamicSourceId })).resolves.toEqual(dynamicSource);

        expect(bridge.fetchCrawlerSource).toHaveBeenCalledWith(dynamicSourceId);
        expect(mockMyFetch).toHaveBeenCalledWith(sourceApi.single, { query: { id: dynamicSourceId } });
    });
});

function createDesktopBridge(sourceIds: string[], sources: Partial<Record<SourceID, SourceResponse>>) {
    return {
        listCrawlerSources: vi.fn(async () => sourceIds),
        fetchCrawlerSource: vi.fn(async (sourceId: string) => sources[sourceId as SourceID] ?? null),
    };
}

function createSource(id: SourceID, title: string, itemId: string, items?: SourceResponse["items"]): SourceResponse {
    return {
        status: "success",
        id,
        name: id,
        updatedTime: 1,
        items: items ?? [
            {
                id: itemId,
                title,
                url: `https://${id}.example.test/${itemId}`,
            },
        ],
    };
}
