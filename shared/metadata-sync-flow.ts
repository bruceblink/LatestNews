import type { MetadataSyncStatus } from "./metadata-sync-types";

export function toQueuedStatus(prev: MetadataSyncStatus, now = Date.now()): MetadataSyncStatus {
    return {
        ...prev,
        phase: "queued",
        lastAttemptAt: now,
        lastErrorMessage: undefined,
    };
}

export function toSyncingStatus(prev: MetadataSyncStatus, now = Date.now()): MetadataSyncStatus {
    return {
        ...prev,
        phase: "syncing",
        lastAttemptAt: now,
        lastErrorMessage: undefined,
    };
}

export function toMergedStatus(prev: MetadataSyncStatus): MetadataSyncStatus {
    return {
        ...prev,
        phase: "merged",
    };
}

export function toConflictResolvedStatus(prev: MetadataSyncStatus): MetadataSyncStatus {
    return {
        ...prev,
        phase: "conflict-resolved",
    };
}

export function toSuccessStatus(prev: MetadataSyncStatus, now = Date.now()): MetadataSyncStatus {
    return {
        ...prev,
        phase: "success",
        lastAttemptAt: now,
        lastSyncedAt: now,
        lastErrorMessage: undefined,
    };
}

export function toErrorStatus(prev: MetadataSyncStatus, message: string, now = Date.now()): MetadataSyncStatus {
    return {
        ...prev,
        phase: "error",
        lastAttemptAt: now,
        lastErrorMessage: message,
    };
}
