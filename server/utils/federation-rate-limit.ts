import process from "node:process";

export interface FederationRateLimitDecision {
    allowed: boolean;
    limit: number;
    remaining: number;
    resetAt: number;
}

export interface CreateFederationRateLimiterOptions {
    limit?: number;
    maxKeys?: number;
    now?: () => number;
    windowMs?: number;
}

interface RateBucket {
    count: number;
    windowStart: number;
}

const DEFAULT_LIMIT = 60;
const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_KEYS = 4_096;

/**
 * Creates a bounded fixed-window limiter for federation route subjects.
 * The subject is normally a validated node ID, never a raw token or browser address.
 */
export function createFederationRateLimiter(options: CreateFederationRateLimiterOptions = {}) {
    const now = options.now ?? Date.now;
    const limit = clampInteger(options.limit ?? DEFAULT_LIMIT, 1, 1_000);
    const windowMs = clampInteger(options.windowMs ?? DEFAULT_WINDOW_MS, 1_000, 3_600_000);
    const maxKeys = clampInteger(options.maxKeys ?? DEFAULT_MAX_KEYS, 16, 10_000);
    const buckets = new Map<string, RateBucket>();

    function check(subject: string): FederationRateLimitDecision {
        const observedAt = now();
        pruneExpiredBuckets(observedAt, windowMs, buckets);
        if (!buckets.has(subject) && buckets.size >= maxKeys) {
            const oldestSubject = buckets.keys().next().value;
            if (oldestSubject) buckets.delete(oldestSubject);
        }

        const windowStart = Math.floor(observedAt / windowMs) * windowMs;
        const bucket = buckets.get(subject);
        if (!bucket || bucket.windowStart !== windowStart) {
            buckets.set(subject, { count: 1, windowStart });
            return decision(true, 1, limit, windowStart + windowMs);
        }

        if (bucket.count >= limit) return decision(false, bucket.count, limit, bucket.windowStart + windowMs);

        bucket.count += 1;
        return decision(true, bucket.count, limit, bucket.windowStart + windowMs);
    }

    return { check };
}

export function getConfiguredFederationRateLimit(value = process.env.LATESTNEWS_FEDERATION_RATE_LIMIT) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? clampInteger(parsed, 1, 1_000) : DEFAULT_LIMIT;
}

const federationRateLimiter = createFederationRateLimiter({ limit: getConfiguredFederationRateLimit() });

/** Returns the process-local limiter used by the downstream route. */
export function getFederationRateLimiter() {
    return federationRateLimiter;
}

function decision(allowed: boolean, count: number, limit: number, resetAt: number): FederationRateLimitDecision {
    return {
        allowed,
        limit,
        remaining: Math.max(0, limit - count),
        resetAt,
    };
}

function pruneExpiredBuckets(observedAt: number, windowMs: number, buckets: Map<string, RateBucket>) {
    for (const [subject, bucket] of buckets) {
        if (bucket.windowStart + windowMs <= observedAt) buckets.delete(subject);
    }
}

function clampInteger(value: number, minimum: number, maximum: number) {
    return Math.min(maximum, Math.max(minimum, Math.floor(value)));
}
