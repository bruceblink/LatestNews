export type MetadataSyncPhase = "idle" | "queued" | "syncing" | "merged" | "conflict-resolved" | "success" | "error";

export type MetadataSyncTransitionSource =
    | "manual-sync"
    | "retry-sync"
    | "restore-from-remote"
    | "restore-to-remote"
    | "auto-upload"
    | "login-sync"
    | "auth-feedback";

export interface MetadataSyncStatus {
    phase: MetadataSyncPhase;
    lastAttemptAt?: number;
    lastSyncedAt?: number;
    lastErrorMessage?: string;
    lastTransitionSource?: MetadataSyncTransitionSource;
}

export const metadataSyncPhases: MetadataSyncPhase[] = [
    "idle",
    "queued",
    "syncing",
    "merged",
    "conflict-resolved",
    "success",
    "error",
];

export function createDefaultMetadataSyncStatus(): MetadataSyncStatus {
    return {
        phase: "idle",
    };
}
