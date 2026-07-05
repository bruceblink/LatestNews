import type { SourceID } from "./types";

export const sourceApi = {
    single: "/s",
    entire: "/s/entire",
    health: "/s/health",
} as const;

export interface SourceQuery {
    id: SourceID;
    latest?: boolean;
}

export interface EntireSourcesPayload {
    sources: SourceID[];
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

export const sourceHealthCacheKey = ["source-health"] as const;
