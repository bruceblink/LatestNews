import type { SourceID, SourceResponse } from "@shared/types";
import type { SourceHealthSummary } from "@shared/source-health-types";
import type { DesktopCollectionMode } from "@shared/desktop-collection-mode";
import type { SourceHealthSourcesResponse } from "@shared/source-health-api";
import type { SourceMetadataResponse, SourceMetadataItemResponse } from "@shared/source-metadata";
import type {
    SourceQuery,
    SourceApiError,
    SourceItemsQuery,
    SourceBatchPayload,
    UnifiedFeedPayload,
    NewsInsightsPayload,
    SourceItemsResponse,
    SourceBatchResponse,
    ArticleEventResponse,
    NewsInsightsResponse,
    ArticleSearchResponse,
    EntireSourcesResponse,
} from "@shared/source-api";

import { myFetch } from "~/utils";
import dataSources from "@shared/data-sources";
import { validArchiveKey } from "@shared/article-archive";
import { isDynamicSourceId } from "@shared/dynamic-source-id";
import { resolveSourceBatchSelection } from "@shared/source-batch";
import { getOrCreateInFlightRequest } from "@shared/in-flight-request";
import { createSourceBatchResponse } from "@shared/source-batch-response";
import { isDesktopCollectionMode } from "@shared/desktop-collection-mode";
import { createSourceMetadataResponse, createSourceMetadataItemResponse } from "@shared/source-metadata";
import { filterSourceItems, parseSourceItemsSince, normalizeSourceItemsLimit } from "@shared/source-items";
import {
    sourceApi,
    getSourceItemsPath,
    createBearerHeaders,
    getSourceMetadataPath,
    getNewsInsightsRequestKey,
} from "@shared/source-api";

import {
    waitForRuntimeCatalog,
    isDesktopOnlyRuntimeSource,
    loadDesktopRuntimeSourceCatalog,
} from "./runtime-source-catalog.service";

const inFlightNewsInsights = new Map<string, Promise<NewsInsightsResponse>>();

/** History exists only on the remote indexed service; never fall back to collector cache. */
async function requireArchiveRemote() {
    const config = await getDesktopNewsApiConfig();
    if (config.mode === "local" || !config.remoteConfigured) {
        throw Object.assign(new Error("Remote archive required"), { code: "ARCHIVE_REMOTE_REQUIRED" });
    }
}

export async function searchArticleArchive(
    query: { q: string; source?: string; since?: string; limit: number },
    signal?: AbortSignal
) {
    await requireArchiveRemote();
    const result = await myFetch<ArticleSearchResponse>(sourceApi.articleSearchV1, { query, signal });
    if (!result?.data || !Array.isArray(result.data.items) || !result.meta) throw new Error("Invalid archive response");
    if (result.data.status === "unavailable") throw Object.assign(new Error("Index unavailable"), { status: 503 });
    return result;
}

export async function fetchArchiveEvent(eventId: string, after?: string, signal?: AbortSignal) {
    if (
        !validArchiveKey(eventId) ||
        eventId.startsWith("candidate-") ||
        (after !== undefined && !validArchiveKey(after))
    ) {
        throw Object.assign(new Error("Invalid event key"), { status: 400 });
    }
    await requireArchiveRemote();
    const result = await myFetch<ArticleEventResponse>(sourceApi.articleEventV1 + "/" + encodeURIComponent(eventId), {
        query: { limit: 30, ...(after ? { after } : {}) },
        signal,
    });
    if (!result?.data || result.data.eventId !== eventId || !Array.isArray(result.data.items) || !result.meta)
        throw new Error("Invalid event response");
    return result;
}

export async function fetchSource(query: SourceQuery, headers?: Record<string, string>): Promise<SourceResponse> {
    const { id, ...itemsQuery } = query;
    return (await fetchSourceItemsV1(id, itemsQuery, headers)).data;
}

export async function fetchSourceItemsV1(
    id: SourceID,
    query?: SourceItemsQuery,
    headers?: Record<string, string>
): Promise<SourceItemsResponse> {
    const bridge = getDesktopBridge();
    const remoteConfig = await getDesktopNewsApiConfig();
    const localOnly = remoteConfig.mode !== "remote" && bridge && isDesktopOnlyRuntimeSource(id);
    if (localOnly || remoteConfig.mode === "local" || !remoteConfig.remoteConfigured) {
        if (bridge && remoteConfig.mode !== "remote" && (await getDesktopLocalSourceIds()).has(id)) {
            const localSource = await fetchDesktopLocalSource(bridge, id, query?.latest || query?.clearCache);
            if (localSource) return createDesktopSourceItemsResponse(localSource, query);
        }
        if (remoteConfig.mode === "remote") throw new Error("远端模式需要配置数据源 API 地址。");
        throw new Error("本地采集不可用，且未配置远端新闻 API。");
    }

    try {
        const refreshHeaders =
            headers ??
            ((query?.latest || query?.clearCache) && typeof window !== "undefined"
                ? createBearerHeaders(window.localStorage?.getItem("access_token"))
                : undefined);
        return await myFetch(getSourceItemsPath(id), { query, ...(refreshHeaders && { headers: refreshHeaders }) });
    } catch (error) {
        if (remoteConfig.mode === "remote" || !bridge || !shouldFallbackToLocal(error)) throw error;
        if (!(await getDesktopLocalSourceIds()).has(id)) throw error;
        const localSource = await fetchDesktopLocalSource(bridge, id, query?.latest || query?.clearCache);
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

function fetchRemoteSourceBatch(payload: SourceBatchPayload): Promise<SourceBatchResponse> {
    return myFetch(sourceApi.sourceBatchV1, {
        method: "POST",
        body: payload,
    });
}

async function fetchDesktopSourceBatch(payload: SourceBatchPayload): Promise<SourceBatchResponse> {
    const bridge = getDesktopBridge();
    if (!bridge) return fetchRemoteSourceBatch(payload);
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

    const envelope = await fetchDesktopEntireSources(selection.sourceIds, bridge, remoteConfig);
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
    bridge: NonNullable<Window["latestNewsDesktop"]>,
    remoteConfig: DesktopNewsApiRuntimeSettings
): Promise<EntireSourcesResponse> {
    // Remote data wins when available. Only omitted sources with a trusted local package
    // are collected locally, so one unavailable source does not discard the other results.
    const uniqueSourceIds = [...new Set(sources)];
    const localSourceIds = await getDesktopLocalSourceIds();
    const remoteConfigured = remoteConfig.remoteConfigured && remoteConfig.mode !== "local";
    let remoteEnvelope: EntireSourcesResponse = createEmptyEntireSourcesEnvelope(uniqueSourceIds);
    const errors: SourceApiError[] = [];

    if (remoteConfigured && uniqueSourceIds.length > 0) {
        try {
            remoteEnvelope = await fetchRemoteSourceBatch({ sources: uniqueSourceIds });
        } catch (error) {
            if (!shouldFallbackToLocal(error)) throw error;
            errors.push({ message: "Remote API request failed; local collection was used where available." });
        }
    }

    const remoteResponses = new Map(remoteEnvelope.data.map((source) => [source.id, source]));
    const localResponses = new Map<SourceID, SourceResponse>();
    const localFailures = new Set<SourceID>();
    const fallbackSourceIds = uniqueSourceIds.filter(
        (sourceId) => localSourceIds.has(sourceId) && !remoteResponses.has(sourceId)
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

async function fetchDesktopLocalSource(
    bridge: NonNullable<Window["latestNewsDesktop"]>,
    sourceId: SourceID,
    refresh?: boolean
) {
    try {
        return (
            (await (refresh ? bridge.fetchCrawlerSource(sourceId, true) : bridge.fetchCrawlerSource(sourceId))) ??
            undefined
        );
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
    desktopSourceIdsPromise ??= bridge
        .listCrawlerSources()
        .then((ids) => new Set(ids as SourceID[]))
        .catch(() => {
            desktopSourceIdsPromise = undefined;
            return new Set<SourceID>();
        });
    let sourceIds = new Set<SourceID>();
    await waitForRuntimeCatalog(
        desktopSourceIdsPromise.then((ids) => {
            sourceIds = ids;
        })
    );
    return sourceIds;
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
    const requestKey = getNewsInsightsRequestKey(payload);
    return getOrCreateInFlightRequest(inFlightNewsInsights, requestKey, () =>
        fetchDesktopPreferred(
            () => myFetch<NewsInsightsResponse>(sourceApi.insightsV1, { method: "POST", body: payload }),
            async (desktop) => {
                // Load the shared aggregation code only when the desktop needs to compute locally.
                const [local, { createNewsInsights }] = await Promise.all([
                    fetchDesktopEntireSources(payload.sources, desktop, { mode: "local", remoteConfigured: false }),
                    import("@shared/news-insights"),
                ]);
                return {
                    ...local,
                    data: createNewsInsights(local.data, { ...payload, generatedAt: local.meta.generatedAt }),
                };
            }
        )
    );
}

export function fetchSourceHealthSummary(): Promise<SourceHealthSummary> {
    return fetchDesktopPreferred(
        async () => {
            const { data, meta } = await myFetch<SourceHealthSourcesResponse>(sourceApi.sourceHealthV1);
            return {
                sources: data,
                updatedAt: meta.generatedAt,
                total: meta.totalSourceCount,
                healthy: meta.healthyCount,
                failing: meta.failingCount,
                idle: meta.idleCount,
                cacheDegraded: meta.cacheDegradedCount,
                ...(meta.sampleScope ? { sampleScope: meta.sampleScope } : {}),
                sampleWindowStartedAt: meta.sampleWindowStartedAt,
            };
        },
        async (bridge) => {
            if (!bridge.getCrawlerSourceHealthSummary) throw new Error("当前桌面版本不支持读取本地采集健康状态。");
            return bridge.getCrawlerSourceHealthSummary();
        }
    );
}

export function fetchSourceMetadata(): Promise<SourceMetadataResponse> {
    return fetchDesktopPreferred(
        () => myFetch(sourceApi.sourcesV1),
        async (bridge) => {
            await waitForRuntimeCatalog(loadDesktopRuntimeSourceCatalog(bridge));
            return createSourceMetadataResponse();
        }
    );
}

export function fetchSourceMetadataItem(id: SourceID): Promise<SourceMetadataItemResponse> {
    if (isDynamicSourceId(id) && dataSources[id]?.disable) {
        return Promise.resolve(createSourceMetadataItemResponse({ sourceId: id })!);
    }
    return fetchDesktopPreferred(
        () => myFetch(getSourceMetadataPath(id)),
        async (bridge) => {
            await waitForRuntimeCatalog(loadDesktopRuntimeSourceCatalog(bridge));
            const response = createSourceMetadataItemResponse({ sourceId: id });
            if (!response) throw new Error(`本地来源目录不包含来源 ${id}。`);
            return response;
        },
        id
    );
}

type DesktopBridge = NonNullable<Window["latestNewsDesktop"]>;

async function fetchDesktopPreferred<T>(
    remote: () => Promise<T>,
    local: (bridge: DesktopBridge) => Promise<T>,
    id?: SourceID
) {
    const bridge = getDesktopBridge();
    if (!bridge) return remote();
    const remoteConfig = await getDesktopNewsApiConfig();
    if (
        remoteConfig.mode === "local" ||
        !remoteConfig.remoteConfigured ||
        (id && remoteConfig.mode === "auto" && isDesktopOnlyRuntimeSource(id))
    ) {
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
