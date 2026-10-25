import type { SourceID, SourceResponse } from "@shared/types";
import type { SourceHealthSummary } from "@shared/source-health-types";
import type { DesktopCollectionMode } from "@shared/desktop-collection-mode";
import type { SourceMetadataResponse, SourceMetadataItemResponse } from "@shared/source-metadata";
import type { SourceHealthSourcesQuery, SourceHealthSourcesResponse } from "@shared/source-health-api";
import type {
    SourceQuery,
    SourceApiError,
    SourceItemsQuery,
    SourceBatchPayload,
    UnifiedFeedPayload,
    NewsInsightsPayload,
    SourceItemsResponse,
    SourceBatchResponse,
    EntireSourcesPayload,
    NewsInsightsResponse,
    EntireSourcesResponse,
} from "@shared/source-api";

import { myFetch } from "~/utils";
import dataSources from "@shared/data-sources";
import { resolveSourceBatchSelection } from "@shared/source-batch";
import { getOrCreateInFlightRequest } from "@shared/in-flight-request";
import { createSourceBatchResponse } from "@shared/source-batch-response";
import { isDesktopCollectionMode } from "@shared/desktop-collection-mode";
import { createSourceHealthSourcesResponse } from "@shared/source-health-api";
import { registerRuntimeSourceCatalog } from "@shared/runtime-source-catalog";
import { createSourceMetadataResponse, createSourceMetadataItemResponse } from "@shared/source-metadata";
import { filterSourceItems, parseSourceItemsSince, normalizeSourceItemsLimit } from "@shared/source-items";
import {
    sourceApi,
    getSourceItemsPath,
    getSourceMetadataPath,
    isEntireSourcesResponse,
    getNewsInsightsRequestKey,
    normalizeEntireSourcesResponse,
} from "@shared/source-api";

const inFlightNewsInsights = new Map<string, Promise<NewsInsightsResponse>>();

export async function fetchSource(query: SourceQuery, headers?: Record<string, string>): Promise<SourceResponse> {
    const bridge = getDesktopBridge();
    const remoteConfig = await getDesktopNewsApiConfig();
    const localSupported = Boolean(
        bridge && remoteConfig.mode !== "remote" && (await getDesktopLocalSourceIds()).has(query.id)
    );
    if (remoteConfig.mode === "local" || !remoteConfig.remoteConfigured) {
        if (localSupported && bridge) {
            const localSource = await fetchDesktopLocalSource(bridge, query.id);
            if (localSource) return localSource;
        }
        if (remoteConfig.mode === "remote") throw new Error("远端模式需要配置数据源 API 地址。");
        throw new Error("本地采集不可用，且未配置远端新闻 API。");
    }

    try {
        return await myFetch(sourceApi.single, { query, headers });
    } catch (error) {
        if (remoteConfig.mode === "remote" || !localSupported || !bridge || !shouldFallbackToLocal(error)) throw error;
        const localSource = await fetchDesktopLocalSource(bridge, query.id);
        if (localSource) return localSource;
        throw error;
    }
}

export function fetchEntireSources(sources: SourceID[]): Promise<SourceResponse[] | undefined> {
    return fetchEntireSourcesEnvelope(sources).then(normalizeEntireSourcesResponse);
}

export async function fetchSourceItemsV1(id: SourceID, query?: SourceItemsQuery): Promise<SourceItemsResponse> {
    const bridge = getDesktopBridge();
    const remoteConfig = await getDesktopNewsApiConfig();
    const localSupported = Boolean(
        bridge && remoteConfig.mode !== "remote" && (await getDesktopLocalSourceIds()).has(id)
    );
    if (remoteConfig.mode === "local" || !remoteConfig.remoteConfigured) {
        if (localSupported && bridge) {
            const localSource = await fetchDesktopLocalSource(bridge, id);
            if (localSource) return createDesktopSourceItemsResponse(localSource, query);
        }
        if (remoteConfig.mode === "remote") throw new Error("远端模式需要配置数据源 API 地址。");
        throw new Error("本地采集不可用，且未配置远端新闻 API。");
    }

    try {
        return await myFetch(getSourceItemsPath(id), { query });
    } catch (error) {
        if (remoteConfig.mode === "remote" || !localSupported || !bridge || !shouldFallbackToLocal(error)) throw error;
        const localSource = await fetchDesktopLocalSource(bridge, id);
        if (localSource) return createDesktopSourceItemsResponse(localSource, query);
        throw error;
    }
}

export function fetchSourceBatchV1(payload: SourceBatchPayload): Promise<SourceBatchResponse> {
    return fetchDesktopSourceBatch(payload);
}

export function fetchUnifiedFeed(payload: UnifiedFeedPayload): Promise<SourceBatchResponse> {
    return fetchSourceBatchV1({
        sources: payload.sources,
        ...(payload.since && { since: payload.since }),
    });
}

export function fetchEntireSourcesEnvelope(sources: SourceID[]): Promise<EntireSourcesResponse | SourceResponse[]> {
    const bridge = getDesktopBridge();
    if (bridge) return fetchDesktopEntireSources(sources, bridge);
    return fetchRemoteEntireSources(sources);
}

function fetchRemoteEntireSources(sources: SourceID[]): Promise<EntireSourcesResponse | SourceResponse[]> {
    const body: EntireSourcesPayload = { sources };

    return myFetch(sourceApi.entire, {
        method: "POST",
        body,
    });
}

function fetchRemoteSourceBatch(payload: SourceBatchPayload): Promise<SourceBatchResponse> {
    return myFetch(sourceApi.sourceBatchV1, {
        method: "POST",
        body: payload,
    });
}

async function fetchDesktopSourceBatch(payload: SourceBatchPayload): Promise<SourceBatchResponse> {
    const remoteConfig = await getDesktopNewsApiConfig();
    if (remoteConfig.mode === "remote") {
        if (!remoteConfig.remoteConfigured) throw new Error("远端模式需要配置数据源 API 地址。");
        return fetchRemoteSourceBatch(payload);
    }
    const localSourceIds = await getDesktopLocalSourceIds();
    if (remoteConfig.mode === "auto" && !localSourceIds.size && remoteConfig.remoteConfigured) {
        return fetchRemoteSourceBatch(payload);
    }

    const selection = resolveSourceBatchSelection(payload);
    if (
        remoteConfig.mode === "auto" &&
        remoteConfig.remoteConfigured &&
        !selection.sourceIds.some((sourceId) => localSourceIds.has(sourceId))
    ) {
        return fetchRemoteSourceBatch(payload);
    }

    const entireResponse = await fetchEntireSourcesEnvelope(selection.sourceIds);
    const envelope = toEntireSourcesEnvelope(entireResponse, selection.sourceIds);
    const validationErrors: SourceApiError[] = [
        ...selection.invalidSourceIds.map((sourceId) => ({ sourceId, message: "Invalid source id" })),
        ...selection.filterErrors,
    ];
    const withErrors: EntireSourcesResponse = {
        ...envelope,
        meta: {
            ...envelope.meta,
            requestedSourceCount: selection.sourceIds.length + selection.invalidSourceIds.length,
            partial: envelope.meta.partial || validationErrors.length > 0,
        },
        errors: [...envelope.errors, ...validationErrors],
    };
    return createSourceBatchResponse(withErrors, payload, selection.sourceIds);
}

async function fetchDesktopEntireSources(
    sources: SourceID[],
    bridge: NonNullable<Window["latestNewsDesktop"]>
): Promise<EntireSourcesResponse> {
    // Remote data wins when available. Only omitted sources with a trusted local package
    // are collected locally, so one unavailable source does not discard the other results.
    const uniqueSourceIds = [...new Set(sources)];
    const remoteConfig = await getDesktopNewsApiConfig();
    if (remoteConfig.mode === "remote" && !remoteConfig.remoteConfigured) {
        throw new Error("远端模式需要配置数据源 API 地址。");
    }
    if (remoteConfig.mode === "remote") {
        return toEntireSourcesEnvelope(await fetchRemoteEntireSources(uniqueSourceIds), uniqueSourceIds);
    }
    const localSourceIds = await getDesktopLocalSourceIds();
    const remoteConfigured = remoteConfig.remoteConfigured && remoteConfig.mode !== "local";
    let remoteEnvelope: EntireSourcesResponse = createEmptyEntireSourcesEnvelope(uniqueSourceIds);
    const errors: SourceApiError[] = [];

    if (remoteConfigured && uniqueSourceIds.length > 0) {
        try {
            remoteEnvelope = toEntireSourcesEnvelope(await fetchRemoteEntireSources(uniqueSourceIds), uniqueSourceIds);
        } catch (error) {
            if (!shouldFallbackToLocal(error)) throw error;
            errors.push({ message: "Remote API request failed; local collection was used where available." });
        }
    }

    const remoteResponses = new Map(remoteEnvelope.data.map((source) => [source.id, source]));
    const localResponses = new Map<SourceID, SourceResponse>();
    const localFailures = new Set<SourceID>();
    const fallbackSourceIds = uniqueSourceIds.filter(
        (sourceId) => localSourceIds.has(sourceId) && (remoteConfig.mode === "local" || !remoteResponses.has(sourceId))
    );
    await Promise.all(
        fallbackSourceIds.map(async (sourceId) => {
            const response = await fetchDesktopLocalSource(bridge, sourceId);
            if (response) localResponses.set(sourceId, response);
            else localFailures.add(sourceId);
        })
    );

    const data = uniqueSourceIds
        .map((sourceId) => remoteResponses.get(sourceId) ?? localResponses.get(sourceId))
        .filter((source): source is SourceResponse => source !== undefined);
    const localResultErrors: SourceApiError[] =
        remoteConfig.mode === "auto" && remoteConfigured
            ? [
                  ...[...localResponses.keys()].map((sourceId) => ({
                      sourceId,
                      message: "Remote source was unavailable; the local collector was used.",
                  })),
                  ...[...localFailures].map((sourceId) => ({
                      sourceId,
                      message: "Remote source was unavailable and the local collector failed.",
                  })),
              ]
            : [...localFailures].map((sourceId) => ({ sourceId, message: "The local collector failed." }));
    const responseIds = new Set(data.map((source) => source.id));
    const omittedSourceIds = uniqueSourceIds.filter((sourceId) => !responseIds.has(sourceId));
    if (remoteConfig.mode === "auto" && !remoteConfigured) {
        errors.push({
            message: "Remote news API is not configured; only local collector sources are available.",
        });
    }
    if (remoteConfig.mode === "local") {
        errors.push(
            ...omittedSourceIds
                .filter((sourceId) => !localSourceIds.has(sourceId))
                .map((sourceId) => ({
                    sourceId,
                    message: "Local mode only supports sources with an enabled desktop collector.",
                }))
        );
    }

    return {
        data,
        meta: {
            generatedAt: remoteEnvelope.meta.generatedAt,
            requestedSourceCount: uniqueSourceIds.length,
            resolvedSourceCount: data.length,
            partial: remoteEnvelope.meta.partial || omittedSourceIds.length > 0,
            omittedSourceIds,
        },
        errors: [...remoteEnvelope.errors, ...errors, ...localResultErrors],
    };
}

async function fetchDesktopLocalSource(bridge: NonNullable<Window["latestNewsDesktop"]>, sourceId: SourceID) {
    try {
        return (await bridge.fetchCrawlerSource(sourceId)) ?? undefined;
    } catch {
        return undefined;
    }
}

function createDesktopSourceItemsResponse(source: SourceResponse, query?: SourceItemsQuery): SourceItemsResponse {
    const since = parseSourceItemsSince(query?.since);
    const limit = normalizeSourceItemsLimit(query?.limit);
    const items = filterSourceItems(source.items, { since, limit });
    return {
        data: { ...source, items },
        meta: {
            generatedAt: Date.now(),
            sourceId: source.id,
            status: source.status,
            itemCount: items.length,
            unfilteredItemCount: source.items.length,
            ...(since !== undefined ? { since } : {}),
            ...(limit !== undefined ? { limit } : {}),
        },
        errors: [],
    };
}

function getDesktopBridge() {
    return typeof window === "undefined" ? undefined : window.latestNewsDesktop;
}

interface DesktopNewsApiRuntimeSettings {
    remoteConfigured: boolean;
    mode: DesktopCollectionMode;
}

let desktopRemoteConfigPromise: Promise<DesktopNewsApiRuntimeSettings> | undefined;
let desktopRemoteConfigBridge: NonNullable<Window["latestNewsDesktop"]> | undefined;

async function getDesktopNewsApiConfig(): Promise<DesktopNewsApiRuntimeSettings> {
    // Cache the setting for this renderer lifetime; saving changes reloads the page.
    const bridge = getDesktopBridge();
    if (!bridge?.getNewsApiUrl) return { remoteConfigured: true, mode: "auto" };
    if (bridge !== desktopRemoteConfigBridge) {
        desktopRemoteConfigBridge = bridge;
        desktopRemoteConfigPromise = undefined;
    }
    desktopRemoteConfigPromise ??= bridge
        .getNewsApiUrl()
        .then((settings) => ({
            remoteConfigured: Boolean(settings.url.trim()),
            mode: isDesktopCollectionMode(settings.mode) ? settings.mode : "auto",
        }))
        .catch(() => ({ remoteConfigured: true, mode: "auto" }));
    return desktopRemoteConfigPromise;
}

function shouldFallbackToLocal(error: unknown) {
    // Network failures and server faults are retryable through the local collector.
    // Authorization, rate-limit, and ordinary application responses are not.
    const status = readErrorStatus(error);
    return status === undefined || status >= 500;
}

function readErrorStatus(error: unknown) {
    if (!error || typeof error !== "object") return undefined;
    const candidate = error as {
        status?: unknown;
        statusCode?: unknown;
        response?: { status?: unknown };
    };
    for (const value of [candidate.status, candidate.statusCode, candidate.response?.status]) {
        if (typeof value === "number" && Number.isFinite(value)) return value;
    }
    return undefined;
}

let desktopSourceIdsPromise: Promise<Set<SourceID>> | undefined;
let desktopSourceIdsBridge: NonNullable<Window["latestNewsDesktop"]> | undefined;

async function getDesktopLocalSourceIds() {
    const bridge = getDesktopBridge();
    if (!bridge) {
        desktopSourceIdsBridge = undefined;
        desktopSourceIdsPromise = undefined;
        return new Set<SourceID>();
    }
    if (bridge !== desktopSourceIdsBridge) {
        desktopSourceIdsBridge = bridge;
        desktopSourceIdsPromise = undefined;
    }
    desktopSourceIdsPromise ??= ensureDesktopRuntimeSourceCatalog(bridge)
        .then(() => bridge.listCrawlerSources())
        .then((sourceIds) => new Set(sourceIds.filter((id): id is SourceID => Object.hasOwn(dataSources, id))))
        .catch(() => new Set<SourceID>());
    return desktopSourceIdsPromise;
}

function toEntireSourcesEnvelope(
    response: EntireSourcesResponse | SourceResponse[] | undefined,
    requestedSourceIds: SourceID[]
): EntireSourcesResponse {
    if (isEntireSourcesResponse(response)) return response;
    const data = normalizeEntireSourcesResponse(response) ?? [];
    const responseIds = new Set(data.map((source) => source.id));
    return {
        data,
        meta: {
            generatedAt: Date.now(),
            requestedSourceCount: requestedSourceIds.length,
            resolvedSourceCount: data.length,
            partial: data.length < requestedSourceIds.length,
            omittedSourceIds: requestedSourceIds.filter((sourceId) => !responseIds.has(sourceId)),
        },
        errors: [],
    };
}

function createEmptyEntireSourcesEnvelope(sourceIds: SourceID[]): EntireSourcesResponse {
    return {
        data: [],
        meta: {
            generatedAt: Date.now(),
            requestedSourceCount: sourceIds.length,
            resolvedSourceCount: 0,
            partial: sourceIds.length > 0,
            omittedSourceIds: sourceIds,
        },
        errors: [],
    };
}

export async function fetchNewsInsights(payload: NewsInsightsPayload): Promise<NewsInsightsResponse> {
    const bridge = getDesktopBridge();
    if (bridge) {
        const remoteConfig = await getDesktopNewsApiConfig();
        if (remoteConfig.mode === "local") throw new Error("本地模式暂不支持远端新闻洞察。");
        if (!remoteConfig.remoteConfigured) throw new Error("未配置远端新闻 API，无法读取新闻洞察。");
    }
    const requestKey = getNewsInsightsRequestKey(payload);
    return getOrCreateInFlightRequest(inFlightNewsInsights, requestKey, () =>
        myFetch(sourceApi.insights, {
            method: "POST",
            body: payload,
        })
    );
}

export function fetchSourceHealthSummary(): Promise<SourceHealthSummary> {
    return fetchDesktopPreferred(
        () => myFetch(sourceApi.health),
        async (bridge) => {
            if (!bridge.getCrawlerSourceHealthSummary) throw new Error("当前桌面版本不支持读取本地采集健康状态。");
            return bridge.getCrawlerSourceHealthSummary();
        }
    );
}

export function fetchSourceHealthSourcesV1(query?: SourceHealthSourcesQuery): Promise<SourceHealthSourcesResponse> {
    return fetchDesktopPreferred(
        () => myFetch(sourceApi.sourceHealthV1, { query }),
        async (bridge) => {
            if (!bridge.getCrawlerSourceHealthSummary) throw new Error("当前桌面版本不支持读取本地采集健康状态。");
            return createSourceHealthSourcesResponse(await bridge.getCrawlerSourceHealthSummary(), query);
        }
    );
}

export function fetchSourceMetadata(): Promise<SourceMetadataResponse> {
    return fetchDesktopPreferred(
        () => myFetch(sourceApi.sourcesV1),
        async (bridge) => {
            await ensureDesktopRuntimeSourceCatalog(bridge);
            return createSourceMetadataResponse();
        }
    );
}

export function fetchSourceMetadataItem(id: SourceID): Promise<SourceMetadataItemResponse> {
    return fetchDesktopPreferred(
        () => myFetch(getSourceMetadataPath(id)),
        async (bridge) => {
            await ensureDesktopRuntimeSourceCatalog(bridge);
            const response = createSourceMetadataItemResponse({ sourceId: id });
            if (!response) throw new Error(`本地来源目录不包含来源 ${id}。`);
            return response;
        }
    );
}

async function fetchDesktopPreferred<T>(remote: () => Promise<T>, local: (bridge: DesktopBridge) => Promise<T>) {
    const bridge = getDesktopBridge();
    if (!bridge) return remote();
    const remoteConfig = await getDesktopNewsApiConfig();
    if (remoteConfig.mode === "local" || !remoteConfig.remoteConfigured) {
        if (remoteConfig.mode === "remote") throw new Error("远端模式需要配置数据源 API 地址。");
        return local(bridge);
    }

    try {
        return await remote();
    } catch (error) {
        if (remoteConfig.mode === "remote" || !shouldFallbackToLocal(error)) throw error;
        return local(bridge);
    }
}

type DesktopBridge = NonNullable<Window["latestNewsDesktop"]>;

let desktopRuntimeCatalogPromise: Promise<void> | undefined;
let desktopRuntimeCatalogBridge: DesktopBridge | undefined;

async function ensureDesktopRuntimeSourceCatalog(bridge: DesktopBridge) {
    if (bridge !== desktopRuntimeCatalogBridge) {
        desktopRuntimeCatalogBridge = bridge;
        desktopRuntimeCatalogPromise = undefined;
    }
    if (!bridge.listCrawlerSourceMetadata) return;

    desktopRuntimeCatalogPromise ??= bridge
        .listCrawlerSourceMetadata()
        .then((sources) => {
            const merged = new Map(
                createSourceMetadataResponse({ includeRedirects: true })
                    .data.sources.filter((source) => source.id.startsWith("ext."))
                    .map((source) => [source.id, source])
            );
            for (const source of sources) merged.set(source.id, source);
            registerRuntimeSourceCatalog([...merged.values()]);
        })
        .catch((error: unknown) => {
            desktopRuntimeCatalogPromise = undefined;
            throw error;
        });
    await desktopRuntimeCatalogPromise;
}
