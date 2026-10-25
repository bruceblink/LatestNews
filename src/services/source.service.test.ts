import { it, vi, expect, describe, afterEach } from "vitest";

import { sourceApi } from "../../shared/source-api";
import { createDynamicSourceId } from "../../shared/dynamic-source-id";
import {
    clearRuntimeSourceCatalog,
    registerRuntimeSourceCatalog,
    createRuntimeSourceMetadataItem,
} from "../../shared/runtime-source-catalog";
import {
    fetchSource,
    fetchNewsInsights,
    fetchSourceBatchV1,
    fetchSourceItemsV1,
    fetchSourceMetadata,
    fetchSourceMetadataItem,
    fetchSourceHealthSummary,
    fetchEntireSourcesEnvelope,
    fetchSourceHealthSourcesV1,
} from "./source.service";

import type { SourceID, SourceResponse } from "../../shared/types";
import type { DesktopCollectionMode } from "../../shared/desktop-collection-mode";

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

    it("serves built-in source metadata locally when the remote API is not configured", async () => {
        const bridge = createDesktopBridge([], {}, "");
        vi.stubGlobal("window", { latestNewsDesktop: bridge });

        await expect(fetchSourceMetadataItem("hackernews")).resolves.toMatchObject({
            data: { id: "hackernews", name: expect.any(String) },
            meta: { sourceId: "hackernews", canonicalSourceId: "hackernews", redirected: false },
        });
        expect(await fetchSourceMetadata()).toMatchObject({
            data: { sources: expect.arrayContaining([expect.objectContaining({ id: "hackernews" })]) },
        });
        expect(mockMyFetch).not.toHaveBeenCalled();
    });

    it("loads dynamic source detail from the trusted desktop plugin catalog", async () => {
        const metadata = createRuntimeSourceMetadataItem({
            id: dynamicSourceId,
            name: "Desktop Dynamic",
            interval: 300_000,
            column: "tech",
            home: "https://example.com",
        });
        const bridge = createDesktopBridge([], {}, "", [metadata]);
        vi.stubGlobal("window", { latestNewsDesktop: bridge });

        await expect(fetchSourceMetadataItem(dynamicSourceId)).resolves.toMatchObject({
            data: { id: dynamicSourceId, name: "Desktop Dynamic", column: "tech" },
        });
        await expect(fetchSourceMetadata()).resolves.toMatchObject({
            data: {
                sources: expect.arrayContaining([expect.objectContaining({ id: dynamicSourceId })]),
                columns: expect.arrayContaining([
                    expect.objectContaining({ id: "tech", sourceIds: expect.arrayContaining([dynamicSourceId]) }),
                ]),
            },
        });
    });

    it("uses local source metadata after a retryable server failure, but not a client error", async () => {
        const bridge = createDesktopBridge([], {}, "https://news.example.com");
        vi.stubGlobal("window", { latestNewsDesktop: bridge });
        mockMyFetch.mockRejectedValueOnce(Object.assign(new Error("unavailable"), { status: 503 }));

        await expect(fetchSourceMetadataItem("hackernews")).resolves.toMatchObject({ data: { id: "hackernews" } });
        expect(bridge.listCrawlerSourceMetadata).toHaveBeenCalledOnce();

        const error = Object.assign(new Error("not found"), { status: 404 });
        mockMyFetch.mockRejectedValueOnce(error);
        await expect(fetchSourceMetadataItem("hackernews")).rejects.toBe(error);
        expect(bridge.listCrawlerSourceMetadata).toHaveBeenCalledOnce();
    });

    it("uses local health summaries and applies the shared health filters", async () => {
        const summary = createHealthSummary();
        const bridge = createDesktopBridge([], {}, "", [], summary);
        vi.stubGlobal("window", { latestNewsDesktop: bridge });

        await expect(fetchSourceHealthSummary()).resolves.toEqual(summary);
        await expect(fetchSourceHealthSourcesV1({ status: "failing", keyword: "hacker" })).resolves.toMatchObject({
            data: [expect.objectContaining({ id: "hackernews", status: "failing" })],
            meta: { totalSourceCount: 2, returnedSourceCount: 1, filters: { status: "failing", keyword: "hacker" } },
        });
        expect(mockMyFetch).not.toHaveBeenCalled();
    });

    it("does not fall back to local health data for authorization failures", async () => {
        const bridge = createDesktopBridge(["hackernews"], { hackernews: localSource });
        vi.stubGlobal("window", { latestNewsDesktop: bridge });
        const error = Object.assign(new Error("unauthorized"), { status: 401 });
        mockMyFetch.mockRejectedValue(error);

        await expect(fetchSourceHealthSummary()).rejects.toBe(error);
        expect(bridge.getCrawlerSourceHealthSummary).not.toHaveBeenCalled();
    });

    it("uses only local services in local mode, even when a remote URL is saved", async () => {
        const health = createHealthSummary();
        const localHackerNews = createSource("hackernews", "Local Hacker News headline", "local-1");
        const bridge = createDesktopBridge(
            ["hackernews"],
            { hackernews: localHackerNews },
            "https://news.example.com",
            [],
            health,
            "local"
        );
        vi.stubGlobal("window", { latestNewsDesktop: bridge });

        await expect(fetchSource({ id: "hackernews" })).resolves.toEqual(localHackerNews);
        await expect(fetchSourceItemsV1("hackernews")).resolves.toMatchObject({
            data: { id: "hackernews", items: localHackerNews.items },
        });
        await expect(fetchSourceBatchV1({ sources: ["hackernews"] })).resolves.toMatchObject({
            data: [expect.objectContaining({ id: "hackernews" })],
        });
        await expect(fetchEntireSourcesEnvelope(["hackernews", "pcbeta-windows11"])).resolves.toMatchObject({
            data: [expect.objectContaining({ id: "hackernews" })],
            errors: expect.arrayContaining([
                expect.objectContaining({
                    sourceId: "pcbeta-windows11",
                    message: expect.stringContaining("enabled desktop collector"),
                }),
            ]),
        });
        await expect(fetchSourceMetadataItem("hackernews")).resolves.toMatchObject({ data: { id: "hackernews" } });
        await expect(fetchSourceHealthSummary()).resolves.toEqual(health);
        await expect(fetchNewsInsights({ sources: ["hackernews"] })).rejects.toThrow("本地模式暂不支持远端新闻洞察");
        expect(mockMyFetch).not.toHaveBeenCalled();
    });

    it("keeps remote mode remote when a retryable request fails", async () => {
        const bridge = createDesktopBridge(
            ["hackernews"],
            { hackernews: localSource },
            "https://news.example.com",
            [],
            createHealthSummary(),
            "remote"
        );
        vi.stubGlobal("window", { latestNewsDesktop: bridge });
        const error = Object.assign(new Error("bad gateway"), { status: 503 });
        mockMyFetch.mockRejectedValue(error);

        await expect(fetchSource({ id: "hackernews" })).rejects.toBe(error);
        await expect(fetchSourceBatchV1({ sources: ["hackernews"] })).rejects.toBe(error);
        await expect(fetchSourceMetadataItem("hackernews")).rejects.toBe(error);
        expect(bridge.fetchCrawlerSource).not.toHaveBeenCalled();
        expect(bridge.listCrawlerSourceMetadata).not.toHaveBeenCalled();
    });

    it("requires a remote URL when remote mode is selected", async () => {
        const bridge = createDesktopBridge(
            ["hackernews"],
            { hackernews: localSource },
            "",
            [],
            createHealthSummary(),
            "remote"
        );
        vi.stubGlobal("window", { latestNewsDesktop: bridge });

        await expect(fetchSource({ id: "hackernews" })).rejects.toThrow("远端模式需要配置数据源 API 地址");
        expect(mockMyFetch).not.toHaveBeenCalled();
        expect(bridge.fetchCrawlerSource).not.toHaveBeenCalled();
    });
});

function createDesktopBridge(
    sourceIds: string[],
    sources: Partial<Record<SourceID, SourceResponse>>,
    remoteUrl = "https://news.example.com",
    metadata: ReturnType<typeof createRuntimeSourceMetadataItem>[] = [],
    health = createHealthSummary(),
    mode: DesktopCollectionMode = "auto"
) {
    return {
        getNewsApiUrl: vi.fn(async () => ({ url: remoteUrl, defaultUrl: "https://news.example.com", mode })),
        listCrawlerSources: vi.fn(async () => sourceIds),
        listCrawlerSourceMetadata: vi.fn(async () => metadata),
        getCrawlerSourceHealthSummary: vi.fn(async () => health),
        fetchCrawlerSource: vi.fn(async (sourceId: string) => sources[sourceId as SourceID] ?? null),
    };
}

function createHealthSummary() {
    return {
        updatedAt: 100,
        total: 2,
        healthy: 1,
        failing: 1,
        idle: 0,
        cacheDegraded: 1,
        sources: [
            {
                id: "hackernews" as SourceID,
                name: "Hacker News",
                status: "failing" as const,
                successCount: 1,
                errorCount: 1,
                consecutiveFailures: 1,
                cacheDegraded: true,
                lastErrorAt: 100,
                lastErrorMessage: "上游请求失败",
                recentEvents: [],
            },
            {
                id: "pcbeta-windows11" as SourceID,
                name: "PCBeta",
                status: "healthy" as const,
                successCount: 1,
                errorCount: 0,
                consecutiveFailures: 0,
                cacheDegraded: false,
                recentEvents: [],
            },
        ],
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
