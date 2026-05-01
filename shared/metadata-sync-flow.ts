import type { MetadataSyncStatus } from "./metadata-sync-types";

export function toSyncingStatus(prev: MetadataSyncStatus, now = Date.now()): MetadataSyncStatus {
    return {
        ...prev,
        phase: "syncing",
        lastAttemptAt: now,
        lastErrorMessage: undefined,
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
