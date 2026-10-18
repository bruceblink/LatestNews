import type { SourceID, SourceResponse } from "@shared/types";
import type { SourceHealthSummary } from "@shared/source-health-types";
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
    const localSource = await tryFetchDesktopSource(query.id);
    if (localSource) return localSource;
    return myFetch(sourceApi.single, { query, headers });
}

export function fetchEntireSources(sources: SourceID[]): Promise<SourceResponse[] | undefined> {
    return fetchEntireSourcesEnvelope(sources).then(normalizeEntireSourcesResponse);
}

export async function fetchSourceItemsV1(id: SourceID, query?: SourceItemsQuery): Promise<SourceItemsResponse> {
    const localSource = await tryFetchDesktopSource(id);
    if (localSource) return createDesktopSourceItemsResponse(localSource, query);
    return myFetch(getSourceItemsPath(id), { query });
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
    const localSourceIds = await getDesktopLocalSourceIds();
    if (!localSourceIds.size) return fetchRemoteSourceBatch(payload);

    const selection = resolveSourceBatchSelection(payload);
    if (!selection.sourceIds.some((sourceId) => localSourceIds.has(sourceId))) {
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
    const uniqueSourceIds = [...new Set(sources)];
    const localSourceIds = await getDesktopLocalSourceIds();
    if (!uniqueSourceIds.some((sourceId) => localSourceIds.has(sourceId))) {
        return toEntireSourcesEnvelope(await fetchRemoteEntireSources(sources), sources);
    }

    const localResponses = new Map<SourceID, SourceResponse>();
    const localFailures = new Set<SourceID>();
    await Promise.all(
        uniqueSourceIds
            .filter((sourceId) => localSourceIds.has(sourceId))
            .map(async (sourceId) => {
                try {
                    const response = await bridge.fetchCrawlerSource(sourceId);
                    if (response) localResponses.set(sourceId, response);
                    else localFailures.add(sourceId);
                } catch {
                    localFailures.add(sourceId);
                }
            })
    );

    const remoteSourceIds = uniqueSourceIds.filter((sourceId) => !localResponses.has(sourceId));
    let remoteEnvelope: EntireSourcesResponse = createEmptyEntireSourcesEnvelope(remoteSourceIds);
    if (remoteSourceIds.length > 0) {
        try {
            remoteEnvelope = toEntireSourcesEnvelope(await fetchRemoteEntireSources(remoteSourceIds), remoteSourceIds);
        } catch {
            remoteEnvelope = {
                ...remoteEnvelope,
                errors: [{ message: "Remote API request failed while loading plugin sources." }],
            };
        }
    }

    const remoteResponses = new Map(remoteEnvelope.data.map((source) => [source.id, source]));
    const data = uniqueSourceIds
        .map((sourceId) => localResponses.get(sourceId) ?? remoteResponses.get(sourceId))
        .filter((source): source is SourceResponse => source !== undefined);
    const localFallbackErrors: SourceApiError[] = [...localFailures]
        .filter((sourceId) => remoteResponses.has(sourceId))
        .map((sourceId) => ({ sourceId, message: "Local plugin failed; the remote source was used." }));
    const errors = [...remoteEnvelope.errors, ...localFallbackErrors];
    const responseIds = new Set(data.map((source) => source.id));
    const omittedSourceIds = uniqueSourceIds.filter((sourceId) => !responseIds.has(sourceId));

    return {
        data,
        meta: {
            generatedAt: remoteEnvelope.meta.generatedAt,
            requestedSourceCount: uniqueSourceIds.length,
            resolvedSourceCount: data.length,
            partial: remoteEnvelope.meta.partial || omittedSourceIds.length > 0,
            omittedSourceIds,
        },
        errors,
    };
}

async function tryFetchDesktopSource(sourceId: SourceID) {
    const bridge = getDesktopBridge();
    if (!bridge || !(await getDesktopLocalSourceIds()).has(sourceId)) return undefined;
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

export function fetchNewsInsights(payload: NewsInsightsPayload): Promise<NewsInsightsResponse> {
    const requestKey = getNewsInsightsRequestKey(payload);
    return getOrCreateInFlightRequest(inFlightNewsInsights, requestKey, () =>
        myFetch(sourceApi.insights, {
            method: "POST",
            body: payload,
        })
    );
}

export function fetchSourceHealthSummary(): Promise<SourceHealthSummary> {
    return myFetch(sourceApi.health);
}

export function fetchSourceHealthSourcesV1(query?: SourceHealthSourcesQuery): Promise<SourceHealthSourcesResponse> {
    return myFetch(sourceApi.sourceHealthV1, {
        query,
    });
}

export function fetchSourceMetadata(): Promise<SourceMetadataResponse> {
    return myFetch(sourceApi.sourcesV1);
}

export function fetchSourceMetadataItem(id: SourceID): Promise<SourceMetadataItemResponse> {
    return myFetch(getSourceMetadataPath(id));
}
