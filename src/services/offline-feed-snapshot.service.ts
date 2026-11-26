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

import { validNewsReloadData } from "./news-reload-schema";
import { NEWS_RELOAD_MAX_AGE_MS, getBrowserNewsCacheScope } from "./news-reload-cache.service";

const STORAGE_KEY = "latestnews:offline-feed-snapshots";
const STORE_VERSION = 1;
const MAX_OFFLINE_FEED_SNAPSHOTS = 12;

interface OfflineFeedSnapshotStore {
    version: typeof STORE_VERSION;
    snapshots: StoredFeedSnapshot[];
}

type StoredFeedSnapshot = OfflineFeedSnapshot & { apiScope?: string };

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

    const scope = getBrowserNewsCacheScope();
    const snapshot: StoredFeedSnapshot = {
        ...createOfflineFeedSnapshot(payload, response),
        ...(scope ? { apiScope: scope } : {}),
    };
    const store = readOfflineFeedSnapshotStore();
    const snapshots = [
        snapshot,
        ...store.snapshots.filter((item) => item.key !== snapshot.key || item.apiScope !== scope),
    ].slice(0, MAX_OFFLINE_FEED_SNAPSHOTS);

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
    return selectOfflineFeedSnapshot(scopedSnapshots(), payload, now);
}

/** Reads the newest matching fresh or stale snapshot without treating expired content as current data. */
export function readOfflineFeedSnapshotStatus(
    payload: OfflineFeedSnapshotPayload,
    now = Date.now()
): OfflineFeedSnapshotReadResult {
    const snapshots = scopedSnapshots();
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

function scopedSnapshots() {
    const scope = getBrowserNewsCacheScope();
    // Legacy records still support the existing offline fallback but never
    // become a fresh online cache for an unverified API target.
    return readOfflineFeedSnapshotStore().snapshots.filter(
        (snapshot) => snapshot.apiScope === undefined || snapshot.apiScope === scope
    );
}

export function readOnlineFeedSnapshot(payload: OfflineFeedSnapshotPayload, now = Date.now()) {
    const scope = getBrowserNewsCacheScope();
    if (!scope || typeof navigator === "undefined" || !navigator.onLine) return undefined;
    const key = createOfflineFeedSnapshotKey(payload);
    return scopedSnapshots()
        .filter(
            (snapshot) =>
                snapshot.apiScope === scope &&
                snapshot.key === key &&
                snapshot.savedAt <= now &&
                now - snapshot.savedAt <= NEWS_RELOAD_MAX_AGE_MS &&
                validNewsReloadData("feed", snapshot.response)
        )
        .sort((a, b) => b.savedAt - a.savedAt)[0];
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

function isStoredOfflineFeedSnapshot(value: unknown): value is StoredFeedSnapshot {
    if (!value || typeof value !== "object") return false;

    const snapshot = value as Partial<StoredFeedSnapshot>;
    return (
        snapshot.version === OFFLINE_FEED_SNAPSHOT_VERSION &&
        typeof snapshot.key === "string" &&
        typeof snapshot.savedAt === "number" &&
        (snapshot.apiScope === undefined || typeof snapshot.apiScope === "string") &&
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
