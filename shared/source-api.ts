import type { NewsInsights } from "./news-insights";
import type { SourceID, SourceResponse } from "./types";
import type { SourceResponseStatus } from "./source-response-status";

export const sourceApi = {
    single: "/s",
    entire: "/s/entire",
    health: "/s/health",
    insights: "/s/insights",
    sourcesV1: "/v1/sources",
    sourceBatchV1: "/v1/sources/batch",
    sourceHealthV1: "/v1/health/sources",
    jsonFeedV1: "/v1/feeds/json",
    rssFeedV1: "/v1/feeds/rss",
} as const;

export interface SourceQuery {
    id: SourceID;
    latest?: boolean;
}

export interface SourceItemsQuery {
    latest?: boolean;
    limit?: number | string;
    since?: number | string;
}

export interface SourceBatchPayload {
    sources?: string[];
    source?: string | string[];
    column?: string | string[];
    type?: string | string[];
    limit?: number | string;
    since?: number | string;
}

export interface EntireSourcesPayload {
    sources: SourceID[];
}

export interface NewsInsightsPayload {
    sources: SourceID[];
    hotLimit?: number;
    topicLimit?: number;
    wordLimit?: number;
    minTopicItems?: number;
    readUrls?: string[];
    hiddenUrls?: string[];
}

export interface UnifiedFeedPayload {
    sources: SourceID[];
    since?: number | string;
}

export interface SourceApiError {
    sourceId?: string;
    message: string;
}

export interface SourceApiResponseMeta {
    generatedAt: number;
    requestedSourceCount: number;
    resolvedSourceCount: number;
    partial: boolean;
    omittedSourceIds: SourceID[];
}

export interface EntireSourcesResponse {
    data: SourceResponse[];
    meta: SourceApiResponseMeta;
    errors: SourceApiError[];
}

export interface SourceBatchResponseMeta extends SourceApiResponseMeta {
    itemCount: number;
    unfilteredItemCount: number;
    filters: {
        sourceIds: SourceID[];
        columns: string[];
        types: string[];
        since?: number;
        limit?: number;
    };
}

export interface SourceBatchResponse {
    data: SourceResponse[];
    meta: SourceBatchResponseMeta;
    errors: SourceApiError[];
}

export interface SourceItemsResponse {
    data: SourceResponse;
    meta: {
        generatedAt: number;
        sourceId: SourceID;
        status: SourceResponseStatus;
        itemCount: number;
        unfilteredItemCount: number;
        since?: number;
        limit?: number;
    };
    errors: SourceApiError[];
}

export interface NewsInsightsResponse {
    data: NewsInsights;
    meta: SourceApiResponseMeta;
    errors: SourceApiError[];
}

export function createBearerHeaders(token: string | null | undefined): Record<string, string> | undefined {
    return token ? { Authorization: `Bearer ${token}` } : undefined;
}

export function getSourceCacheKey(id: SourceID) {
    return ["source", id] as const;
}

export function getSourceItemsPath(id: SourceID) {
    return `${sourceApi.sourcesV1}/${id}/items` as const;
}

export function getSourceItemsV1CacheKey(id: SourceID, query: SourceItemsQuery = {}) {
    return ["source-items-v1", id, query.latest, query.since, query.limit] as const;
}

export function getEntireSourcesCacheKey(ids: SourceID[]) {
    return ["entire", [...ids].sort()] as const;
}

export function getNewsInsightsCacheKey(payload: NewsInsightsPayload) {
    return [
        "news-insights",
        [...payload.sources].sort(),
        payload.hotLimit,
        payload.topicLimit,
        payload.wordLimit,
        payload.minTopicItems,
        [...(payload.readUrls ?? [])].sort(),
        [...(payload.hiddenUrls ?? [])].sort(),
    ] as const;
}

export function getNewsInsightsRequestKey(payload: NewsInsightsPayload) {
    return JSON.stringify(getNewsInsightsCacheKey(payload));
}

export function getUnifiedFeedCacheKey(payload: UnifiedFeedPayload) {
    return ["unified-feed", [...payload.sources].sort(), payload.since] as const;
}

export function isEntireSourcesResponse(value: unknown): value is EntireSourcesResponse {
    return Boolean(value && typeof value === "object" && "data" in value && Array.isArray(value.data));
}

export function normalizeEntireSourcesResponse(response: EntireSourcesResponse | SourceResponse[] | undefined) {
    if (!response) return undefined;
    return Array.isArray(response) ? response : response.data;
}

export const sourceHealthCacheKey = ["source-health"] as const;
export const sourceMetadataCacheKey = ["source-metadata"] as const;
