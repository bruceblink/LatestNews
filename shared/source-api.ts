import type { SourceID, SourceResponse } from "./types";
import type { PublicSourceErrorCode } from "./source-error";
import type { SourceResponseStatus } from "./source-response-status";
import type { NewsInsights, InsightTrendWindow } from "./news-insights";

export const sourceApi = {
    articleMaintenanceV1: "/v1/articles/maintenance",
    articleSearchV1: "/v1/articles/search",
    articleEventV1: "/v1/events",
    insightsV1: "/v1/insights",
    loginCapabilityV1: "/v1/auth/capability",
    nodeV1: "/v1/node",
    openApiV1: "/v1/openapi.json",
    sourcesV1: "/v1/sources",
    sourceBatchV1: "/v1/sources/batch",
    sourceRefreshV1: "/v1/sources/refresh",
    sourceHealthV1: "/v1/health/sources",
    deploymentHealthV1: "/v1/health/deployment",
    sourceHealthDiagnosticsV1: "/v1/health/diagnostics",
    jsonFeedV1: "/v1/feeds/json",
    rssFeedV1: "/v1/feeds/rss",
} as const;

export interface SourceQuery {
    clearCache?: boolean;
    id: SourceID;
    latest?: boolean;
}

export interface SourceItemsQuery {
    clearCache?: boolean;
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

export interface NewsInsightsPayload {
    sources: SourceID[];
    hotLimit?: number;
    topicLimit?: number;
    wordLimit?: number;
    trendLimit?: number;
    trendWindow?: InsightTrendWindow;
    minTopicItems?: number;
    readUrls?: string[];
    hiddenUrls?: string[];
}

export interface UnifiedFeedPayload {
    sources: SourceID[];
    since?: number | string;
}

export interface SourceApiError {
    code?: PublicSourceErrorCode;
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

export interface ArticleSearchItem {
    articleKey: string;
    canonicalUrl: string;
    title: string;
    publishedAt?: number | string;
    eventId?: string;
    sourceIds: SourceID[];
    item: SourceResponse["items"][number];
    score?: number;
}

export interface ArticleSearchResponse {
    data: {
        status: "ok" | "unavailable";
        searchMode: "fts" | "like" | "unavailable";
        query: string;
        items: ArticleSearchItem[];
    };
    meta: {
        generatedAt: number;
        itemCount: number;
        sourceId?: SourceID;
        since?: number;
        limit: number;
    };
    errors: SourceApiError[];
}

export interface ArticleEventResponse {
    data: {
        eventId: string;
        canonicalEventId?: string;
        registeredAt: number;
        items: ArticleSearchItem[];
    };
    meta: {
        generatedAt: number;
        itemCount: number;
        limit: number;
        nextCursor?: string;
    };
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

export function getSourceMetadataPath(id: SourceID) {
    return `${sourceApi.sourcesV1}/${id}` as const;
}

export function getSourceMetadataItemCacheKey(id: SourceID) {
    return ["source-metadata-item", id] as const;
}

export function getSourceItemsV1CacheKey(id: SourceID, query: SourceItemsQuery = {}) {
    return ["source-items-v1", id, query.latest, query.clearCache, query.since, query.limit] as const;
}

export function getNewsInsightsCacheKey(payload: NewsInsightsPayload) {
    return [
        "news-insights",
        [...payload.sources].sort(),
        payload.hotLimit,
        payload.topicLimit,
        payload.wordLimit,
        payload.trendLimit,
        payload.trendWindow,
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

export const sourceHealthCacheKey = ["source-health"] as const;
export const sourceMetadataCacheKey = ["source-metadata"] as const;
export const deploymentHealthCacheKey = ["deployment-health"] as const;
