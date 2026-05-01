export type MetadataSyncPhase = "idle" | "queued" | "syncing" | "merged" | "conflict-resolved" | "success" | "error";

export interface MetadataSyncStatus {
    phase: MetadataSyncPhase;
    lastAttemptAt?: number;
    lastSyncedAt?: number;
    lastErrorMessage?: string;
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
