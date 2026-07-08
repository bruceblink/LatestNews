import type { SourceID } from "./types";
import type { SourceBatchResponse } from "./source-api";

export const OFFLINE_FEED_SNAPSHOT_VERSION = 1;
export const DEFAULT_OFFLINE_FEED_SNAPSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface OfflineFeedSnapshotPayload {
    scope?: string;
    since?: number | string;
    sources: SourceID[];
}

export interface OfflineFeedSnapshot {
    version: typeof OFFLINE_FEED_SNAPSHOT_VERSION;
    key: string;
    savedAt: number;
    sourceIds: SourceID[];
    response: SourceBatchResponse;
    scope?: string;
    since?: number | string;
}

export function createOfflineFeedSnapshot(
    payload: OfflineFeedSnapshotPayload,
    response: SourceBatchResponse,
    savedAt = Date.now()
): OfflineFeedSnapshot {
    const sourceIds = normalizeOfflineFeedSnapshotSources(payload.sources);
    const scope = normalizeOfflineFeedSnapshotToken(payload.scope);
    const since = normalizeOfflineFeedSnapshotToken(payload.since);

    return {
        version: OFFLINE_FEED_SNAPSHOT_VERSION,
        key: createOfflineFeedSnapshotKey(payload),
        savedAt,
        sourceIds,
        response,
        ...(scope && { scope: String(scope) }),
        ...(since !== undefined && { since }),
    };
}

export function createOfflineFeedSnapshotKey(payload: OfflineFeedSnapshotPayload) {
    return JSON.stringify({
        scope: normalizeOfflineFeedSnapshotToken(payload.scope) ?? "",
        since: normalizeOfflineFeedSnapshotToken(payload.since) ?? "",
        sourceIds: normalizeOfflineFeedSnapshotSources(payload.sources),
    });
}

export function selectOfflineFeedSnapshot(
    snapshots: OfflineFeedSnapshot[],
    payload: OfflineFeedSnapshotPayload,
    now = Date.now(),
    maxAgeMs = DEFAULT_OFFLINE_FEED_SNAPSHOT_MAX_AGE_MS
): OfflineFeedSnapshot | undefined {
    const key = createOfflineFeedSnapshotKey(payload);

    return snapshots
        .filter((snapshot) => snapshot.key === key && isFreshOfflineFeedSnapshot(snapshot, now, maxAgeMs))
        .sort((left, right) => right.savedAt - left.savedAt)[0];
}

export function isFreshOfflineFeedSnapshot(
    snapshot: OfflineFeedSnapshot,
    now = Date.now(),
    maxAgeMs = DEFAULT_OFFLINE_FEED_SNAPSHOT_MAX_AGE_MS
) {
    return (
        snapshot.version === OFFLINE_FEED_SNAPSHOT_VERSION &&
        Number.isFinite(snapshot.savedAt) &&
        snapshot.savedAt <= now + 60 * 1000 &&
        now - snapshot.savedAt <= maxAgeMs &&
        snapshot.sourceIds.length > 0 &&
        Array.isArray(snapshot.response.data)
    );
}

export function normalizeOfflineFeedSnapshotSources(sources: SourceID[]): SourceID[] {
    return Array.from(new Set(sources.map((source) => source.trim()).filter(Boolean))).sort() as SourceID[];
}

function normalizeOfflineFeedSnapshotToken(value: number | string | undefined): number | string | undefined {
    if (value === undefined) return undefined;
    if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : undefined;

    const trimmed = value.trim();
    if (!trimmed) return undefined;

    const numericValue = Number(trimmed);
    return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : trimmed;
}
