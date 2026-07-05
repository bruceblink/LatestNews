export const sourceResponseStatuses = ["success", "cache", "degraded-cache", "stale-cache", "empty"] as const;

export type SourceResponseStatus = (typeof sourceResponseStatuses)[number];

interface CachedSourceResponseStatusInput {
    cacheUpdatedAt: number;
    degraded?: boolean;
    now: number;
    ttl: number;
}

interface CachedSourceResponsePolicyInput extends CachedSourceResponseStatusInput {
    canRefresh: boolean;
    latest: boolean;
    sourceInterval: number;
}

export function getCachedSourceResponseStatus({
    cacheUpdatedAt,
    degraded = false,
    now,
    ttl,
}: CachedSourceResponseStatusInput): Extract<SourceResponseStatus, "cache" | "degraded-cache" | "stale-cache"> {
    const age = getCacheAge(cacheUpdatedAt, now);

    if (age >= ttl) return "stale-cache";
    if (degraded) return "degraded-cache";
    return "cache";
}

export function getFetchedSourceResponseStatus(itemCount: number): Extract<SourceResponseStatus, "success" | "empty"> {
    return itemCount > 0 ? "success" : "empty";
}

export function shouldReturnCachedSourceResponse({
    cacheUpdatedAt,
    canRefresh,
    degraded = false,
    latest,
    now,
    sourceInterval,
    ttl,
}: CachedSourceResponsePolicyInput) {
    const age = getCacheAge(cacheUpdatedAt, now);

    if (age < sourceInterval) return true;
    return age < ttl && (degraded || !latest || !canRefresh);
}

export function isCacheSourceResponseStatus(status: SourceResponseStatus) {
    return status === "cache" || status === "degraded-cache" || status === "stale-cache";
}

function getCacheAge(cacheUpdatedAt: number, now: number) {
    return Math.max(0, now - cacheUpdatedAt);
}
