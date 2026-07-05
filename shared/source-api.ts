import type { SourceID } from "./types";
import type { NewsInsights } from "./news-insights";

export const sourceApi = {
    single: "/s",
    entire: "/s/entire",
    health: "/s/health",
    insights: "/s/insights",
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

export interface NewsInsightsResponse {
    data: NewsInsights;
    meta: {
        generatedAt: number;
        requestedSourceCount: number;
        resolvedSourceCount: number;
        partial: boolean;
        omittedSourceIds: SourceID[];
    };
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

export const sourceHealthCacheKey = ["source-health"] as const;
