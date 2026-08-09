import type {
    OfflineReadingSnapshot,
    OfflineReadingSnapshotInput,
    OfflineReadingSnapshotState,
} from "@shared/offline-reading-state";

import {
    createOfflineReadingSnapshot,
    migrateOfflineReadingSnapshot,
    getOfflineReadingSnapshotState,
} from "@shared/offline-reading-state";

export const OFFLINE_READING_SNAPSHOT_STORAGE_KEY = "latestnews:offline-reading-snapshot";

export type OfflineReadingSnapshotAvailability = OfflineReadingSnapshotState | "missing";

export interface OfflineReadingSnapshotReadResult {
    state: OfflineReadingSnapshotAvailability;
    snapshot?: OfflineReadingSnapshot;
}

/**
 * Persists a normalized reading snapshot without touching application atoms or sync queues.
 * Returns undefined when browser storage is unavailable or rejects the write.
 */
export function saveOfflineReadingSnapshot(
    input: OfflineReadingSnapshotInput,
    savedAt = Date.now()
): OfflineReadingSnapshot | undefined {
    const storage = getLocalStorage();
    if (!storage) return undefined;

    const snapshot = createOfflineReadingSnapshot(input, savedAt);

    try {
        storage.setItem(OFFLINE_READING_SNAPSHOT_STORAGE_KEY, JSON.stringify(snapshot));
        return snapshot;
    } catch {
        return undefined;
    }
}

/**
 * Reads one persisted snapshot and reports whether it is usable, stale, missing, or invalid.
 * Invalid records are never returned, so callers cannot accidentally render corrupted data.
 */
export function readOfflineReadingSnapshot(now = Date.now()): OfflineReadingSnapshotReadResult {
    const storage = getLocalStorage();
    if (!storage) return { state: "missing" };

    let raw: string | null;
    try {
        raw = storage.getItem(OFFLINE_READING_SNAPSHOT_STORAGE_KEY);
    } catch {
        return { state: "missing" };
    }

    if (!raw) return { state: "missing" };

    try {
        const snapshot = migrateOfflineReadingSnapshot(JSON.parse(raw));
        if (!snapshot) return { state: "invalid" };

        const state = getOfflineReadingSnapshotState(snapshot, now);
        return state === "invalid" ? { state } : { state, snapshot };
    } catch {
        return { state: "invalid" };
    }
}

/** Returns browser storage only when this code runs in a browser and storage access succeeds. */
interface BrowserStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}

function getLocalStorage(): BrowserStorage | undefined {
    const browser = globalThis as typeof globalThis & { localStorage?: BrowserStorage };

    try {
        return browser.localStorage ?? undefined;
    } catch {
        return undefined;
    }
}
