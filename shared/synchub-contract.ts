export const defaultSyncHubEndpoint = "https://sync.likanug.app";

export const latestNewsSyncHubCollections = ["reading-history", "favorites", "preferences"] as const;

export type LatestNewsSyncHubCollection = (typeof latestNewsSyncHubCollections)[number];

export function normalizeSyncHubEndpoint(value: string) {
    return value.trim().replace(/\/+$/, "") || defaultSyncHubEndpoint;
}

export function latestNewsSyncHubURL(endpoint: string, collection: LatestNewsSyncHubCollection) {
    return `${normalizeSyncHubEndpoint(endpoint)}/api/v1/metadata/latestnews/${collection}`;
}

export function syncHubHeaders(apiKey: string) {
    return {
        "Content-Type": "application/json",
        "X-API-Key": apiKey.trim(),
    };
}
