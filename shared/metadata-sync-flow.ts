import type { MetadataSyncStatus, MetadataSyncTransitionSource } from "./metadata-sync-types";

export function toQueuedStatus(
    prev: MetadataSyncStatus,
    source: MetadataSyncTransitionSource,
    now = Date.now()
): MetadataSyncStatus {
    return {
        ...prev,
        phase: "queued",
        lastAttemptAt: now,
        lastErrorMessage: undefined,
        lastTransitionSource: source,
    };
}

export function toSyncingStatus(
    prev: MetadataSyncStatus,
    source: MetadataSyncTransitionSource,
    now = Date.now()
): MetadataSyncStatus {
    return {
        ...prev,
        phase: "syncing",
        lastAttemptAt: now,
        lastErrorMessage: undefined,
        lastTransitionSource: source,
    };
}

export function toMergedStatus(prev: MetadataSyncStatus, source: MetadataSyncTransitionSource): MetadataSyncStatus {
    return {
        ...prev,
        phase: "merged",
        lastTransitionSource: source,
    };
}

export function toConflictResolvedStatus(
    prev: MetadataSyncStatus,
    source: MetadataSyncTransitionSource
): MetadataSyncStatus {
    return {
        ...prev,
        phase: "conflict-resolved",
        lastTransitionSource: source,
    };
}

export function toSuccessStatus(
    prev: MetadataSyncStatus,
    source: MetadataSyncTransitionSource,
    now = Date.now()
): MetadataSyncStatus {
    return {
        ...prev,
        phase: "success",
        lastAttemptAt: now,
        lastSyncedAt: now,
        lastErrorMessage: undefined,
        lastTransitionSource: source,
    };
}

export function toErrorStatus(
    prev: MetadataSyncStatus,
    source: MetadataSyncTransitionSource,
    message: string,
    now = Date.now()
): MetadataSyncStatus {
    return {
        ...prev,
        phase: "error",
        lastAttemptAt: now,
        lastErrorMessage: message,
        lastTransitionSource: source,
    };
}
