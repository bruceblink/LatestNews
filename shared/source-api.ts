import type { NewsInsights } from "./news-insights";
import type { SourceID, SourceResponse } from "./types";

export const sourceApi = {
    single: "/s",
    entire: "/s/entire",
    health: "/s/health",
    insights: "/s/insights",
    sourcesV1: "/v1/sources",
} as const;

export interface SourceQuery {
    id: SourceID;
    latest?: boolean;
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
    ] as const;
}

export function isEntireSourcesResponse(value: unknown): value is EntireSourcesResponse {
    return Boolean(value && typeof value === "object" && "data" in value && Array.isArray(value.data));
}

export function normalizeEntireSourcesResponse(response: EntireSourcesResponse | SourceResponse[] | undefined) {
    if (!response) return undefined;
    return Array.isArray(response) ? response : response.data;
}

export const sourceHealthCacheKey = ["source-health"] as const;
