import type { SourceBatchResponse } from "@shared/source-api";
import type {
    OfflineFeedSnapshot,
    OfflineFeedSnapshotState,
    OfflineFeedSnapshotPayload,
} from "@shared/offline-feed-snapshot";

import {
    createOfflineFeedSnapshot,
    selectOfflineFeedSnapshot,
    getOfflineFeedSnapshotState,
    createOfflineFeedSnapshotKey,
    OFFLINE_FEED_SNAPSHOT_VERSION,
} from "@shared/offline-feed-snapshot";

const STORAGE_KEY = "latestnews:offline-feed-snapshots";
const STORE_VERSION = 1;
const MAX_OFFLINE_FEED_SNAPSHOTS = 12;

interface OfflineFeedSnapshotStore {
    version: typeof STORE_VERSION;
    snapshots: OfflineFeedSnapshot[];
}

export type OfflineFeedSnapshotAvailability = OfflineFeedSnapshotState | "missing";

export interface OfflineFeedSnapshotReadResult {
    state: OfflineFeedSnapshotAvailability;
    snapshot?: OfflineFeedSnapshot;
}

export function saveOfflineFeedSnapshot(
    payload: OfflineFeedSnapshotPayload,
    response: SourceBatchResponse
): OfflineFeedSnapshot | undefined {
    const storage = getLocalStorage();
    if (!storage) return undefined;

    const snapshot = createOfflineFeedSnapshot(payload, response);
    const store = readOfflineFeedSnapshotStore();
    const snapshots = [snapshot, ...store.snapshots.filter((item) => item.key !== snapshot.key)].slice(
        0,
        MAX_OFFLINE_FEED_SNAPSHOTS
    );

    try {
        storage.setItem(
            STORAGE_KEY,
            JSON.stringify({
                version: STORE_VERSION,
                snapshots,
            } satisfies OfflineFeedSnapshotStore)
        );
        return snapshot;
    } catch {
        return undefined;
    }
}

export function readOfflineFeedSnapshot(
    payload: OfflineFeedSnapshotPayload,
    now = Date.now()
): OfflineFeedSnapshot | undefined {
    return selectOfflineFeedSnapshot(readOfflineFeedSnapshotStore().snapshots, payload, now);
}

/** Reads the newest matching fresh or stale snapshot without treating expired content as current data. */
export function readOfflineFeedSnapshotStatus(
    payload: OfflineFeedSnapshotPayload,
    now = Date.now()
): OfflineFeedSnapshotReadResult {
    const snapshots = readOfflineFeedSnapshotStore().snapshots;
    const key = createOfflineFeedSnapshotKey(payload);
    const matchingSnapshots = snapshots
        .filter((snapshot) => snapshot.key === key)
        .sort((left, right) => right.savedAt - left.savedAt);
    if (!matchingSnapshots.length) return { state: "missing" };

    const freshSnapshot = matchingSnapshots.find((snapshot) => getOfflineFeedSnapshotState(snapshot, now) === "fresh");
    if (freshSnapshot) return { state: "fresh", snapshot: freshSnapshot };

    const staleSnapshot = matchingSnapshots.find((snapshot) => getOfflineFeedSnapshotState(snapshot, now) === "stale");
    if (staleSnapshot) return { state: "stale", snapshot: staleSnapshot };

    return { state: "invalid" };
}

function readOfflineFeedSnapshotStore(): OfflineFeedSnapshotStore {
    const storage = getLocalStorage();
    if (!storage) return createEmptyStore();

    try {
        const raw = storage.getItem(STORAGE_KEY);
        if (!raw) return createEmptyStore();

        const parsed = JSON.parse(raw) as Partial<OfflineFeedSnapshotStore>;
        if (parsed.version !== STORE_VERSION || !Array.isArray(parsed.snapshots)) return createEmptyStore();

        return {
            version: STORE_VERSION,
            snapshots: parsed.snapshots.filter(isStoredOfflineFeedSnapshot),
        };
    } catch {
        return createEmptyStore();
    }
}

function createEmptyStore(): OfflineFeedSnapshotStore {
    return {
        version: STORE_VERSION,
        snapshots: [],
    };
}

function isStoredOfflineFeedSnapshot(value: unknown): value is OfflineFeedSnapshot {
    if (!value || typeof value !== "object") return false;

    const snapshot = value as Partial<OfflineFeedSnapshot>;
    return (
        snapshot.version === OFFLINE_FEED_SNAPSHOT_VERSION &&
        typeof snapshot.key === "string" &&
        typeof snapshot.savedAt === "number" &&
        Array.isArray(snapshot.sourceIds) &&
        Boolean(snapshot.response && Array.isArray(snapshot.response.data))
    );
}

function getLocalStorage(): Storage | undefined {
    if (typeof window === "undefined") return undefined;

    try {
        return window.localStorage;
    } catch {
        return undefined;
    }
}
