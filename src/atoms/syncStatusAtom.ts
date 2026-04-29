import { atom } from "jotai";

export type MetadataSyncPhase = "idle" | "queued" | "syncing" | "merged" | "conflict-resolved" | "success" | "error";

export interface MetadataSyncStatus {
    phase: MetadataSyncPhase;
    lastAttemptAt?: number;
    lastSyncedAt?: number;
    lastErrorMessage?: string;
}

const STORAGE_KEY = "metadata-sync-status";

const validPhases: MetadataSyncPhase[] = [
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

function readStoredSyncStatus(): MetadataSyncStatus {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createDefaultMetadataSyncStatus();

    try {
        const parsed = JSON.parse(raw) as MetadataSyncStatus;
        if (!validPhases.includes(parsed.phase)) {
            return createDefaultMetadataSyncStatus();
        }

        return parsed;
    } catch {
        return createDefaultMetadataSyncStatus();
    }
}

const baseSyncStatusAtom = atom(readStoredSyncStatus());

export const metadataSyncStatusAtom = atom(
    (get) => get(baseSyncStatusAtom),
    (get, set, update: MetadataSyncStatus | ((prev: MetadataSyncStatus) => MetadataSyncStatus)) => {
        const current = get(baseSyncStatusAtom);
        const nextValue = update instanceof Function ? update(current) : update;

        set(baseSyncStatusAtom, nextValue);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(nextValue));
    }
);
