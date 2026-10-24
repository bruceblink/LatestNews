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

    it("uses the remote API before an enabled local source", async () => {
        const bridge = createDesktopBridge(["hackernews"], { hackernews: localSource });
        vi.stubGlobal("window", { latestNewsDesktop: bridge });
        mockMyFetch.mockResolvedValue(remoteSource);

        await expect(fetchSource({ id: "hackernews", latest: true })).resolves.toEqual(remoteSource);

        expect(mockMyFetch).toHaveBeenCalledWith(sourceApi.single, {
            query: { id: "hackernews", latest: true },
            headers: undefined,
        });
        expect(bridge.fetchCrawlerSource).not.toHaveBeenCalled();
    });

    it("falls back to an enabled local source after a retryable remote failure", async () => {
        const bridge = createDesktopBridge(["hackernews"], { hackernews: localSource });
        vi.stubGlobal("window", { latestNewsDesktop: bridge });
        mockMyFetch.mockRejectedValue(Object.assign(new Error("bad gateway"), { status: 502 }));

        await expect(fetchSource({ id: "hackernews" })).resolves.toEqual(localSource);
        expect(bridge.fetchCrawlerSource).toHaveBeenCalledWith("hackernews");
    });

    it("does not fall back when the remote API rejects authorization", async () => {
        const bridge = createDesktopBridge(["hackernews"], { hackernews: localSource });
        vi.stubGlobal("window", { latestNewsDesktop: bridge });
        const error = Object.assign(new Error("unauthorized"), { status: 401 });
        mockMyFetch.mockRejectedValue(error);

        await expect(fetchSource({ id: "hackernews" })).rejects.toBe(error);
        expect(bridge.fetchCrawlerSource).not.toHaveBeenCalled();
    });

    it("keeps a successful empty remote result", async () => {
        const bridge = createDesktopBridge(["hackernews"], { hackernews: localSource });
        vi.stubGlobal("window", { latestNewsDesktop: bridge });
        mockMyFetch.mockResolvedValue({ ...remoteSource, status: "empty", items: [] });

        await expect(fetchSource({ id: "hackernews" })).resolves.toMatchObject({ status: "empty", items: [] });
        expect(bridge.fetchCrawlerSource).not.toHaveBeenCalled();
    });

    it("uses local sources without calling the remote API when no URL is configured", async () => {
        const bridge = createDesktopBridge(["hackernews"], { hackernews: localSource }, "");
        vi.stubGlobal("window", { latestNewsDesktop: bridge });

        await expect(fetchSource({ id: "hackernews" })).resolves.toEqual(localSource);
        expect(mockMyFetch).not.toHaveBeenCalled();
        expect(bridge.fetchCrawlerSource).toHaveBeenCalledWith("hackernews");
    });

    it("reports an unsupported local source when no remote API is configured", async () => {
        const bridge = createDesktopBridge([], {}, "");
        vi.stubGlobal("window", { latestNewsDesktop: bridge });

        await expect(fetchSource({ id: "hackernews" })).rejects.toThrow("未配置远端新闻 API");
        expect(mockMyFetch).not.toHaveBeenCalled();
    });

    it("applies source-items filters to local fallback results", async () => {
        const source = createSource("hackernews", "Local headline", "local-1", [
            { id: "new", title: "New item", url: "https://local.example.test/new", pubDate: 300 },
            { id: "old", title: "Old item", url: "https://local.example.test/old", pubDate: 100 },
        ]);
        const bridge = createDesktopBridge(["hackernews"], { hackernews: source });
        vi.stubGlobal("window", { latestNewsDesktop: bridge });
        mockMyFetch.mockRejectedValue(Object.assign(new Error("unavailable"), { status: 503 }));

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
    });

    it("merges remote and local source responses when the remote omits a local source", async () => {
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
            body: { sources: ["hackernews", "pcbeta-windows11"] },
        });
    });

    it("applies normal feed filters after merging remote and local sources", async () => {
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

    it("uses a registered dynamic source when the remote response omits it", async () => {
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
                omittedSourceIds: [dynamicSourceId],
            },
            errors: [],
        });

        const response = await fetchSourceBatchV1({ sources: ["hackernews", dynamicSourceId] });

        expect(response.data.map((source) => source.id)).toEqual(["hackernews", dynamicSourceId]);
        expect(bridge.fetchCrawlerSource).toHaveBeenCalledWith(dynamicSourceId);
        expect(mockMyFetch).toHaveBeenCalledWith(sourceApi.entire, {
            method: "POST",
            body: { sources: ["hackernews", dynamicSourceId] },
        });
    });

    it("uses local sources for the whole batch after a retryable remote failure", async () => {
        const bridge = createDesktopBridge(["pcbeta-windows11"], { "pcbeta-windows11": localSource });
        vi.stubGlobal("window", { latestNewsDesktop: bridge });
        mockMyFetch.mockRejectedValue(Object.assign(new Error("bad gateway"), { status: 502 }));

        const response = await fetchSourceBatchV1({ sources: ["pcbeta-windows11"] });

        expect(response.data.map((source) => source.id)).toEqual(["pcbeta-windows11"]);
        expect(response.errors).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ message: expect.stringContaining("local collection was used") }),
            ])
        );
    });

    it("does not use local sources when the remote batch rejects authorization", async () => {
        const bridge = createDesktopBridge(["pcbeta-windows11"], { "pcbeta-windows11": localSource });
        vi.stubGlobal("window", { latestNewsDesktop: bridge });
        const error = Object.assign(new Error("forbidden"), { status: 403 });
        mockMyFetch.mockRejectedValue(error);

        await expect(fetchSourceBatchV1({ sources: ["pcbeta-windows11"] })).rejects.toBe(error);
        expect(bridge.fetchCrawlerSource).not.toHaveBeenCalled();
    });
});

function createDesktopBridge(
    sourceIds: string[],
    sources: Partial<Record<SourceID, SourceResponse>>,
    remoteUrl = "https://news.example.com"
) {
    return {
        getNewsApiUrl: vi.fn(async () => ({ url: remoteUrl, defaultUrl: "https://news.example.com" })),
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
                url: "https://" + id + ".example.test/" + itemId,
            },
        ],
    };
}
