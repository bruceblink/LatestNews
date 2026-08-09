import { normalizeReadingState, normalizeReadingStateUrl } from "./reading-state";

import type { SourceID } from "./types";
import type { ReadingStateItem } from "./reading-state";

export const OFFLINE_READING_SNAPSHOT_VERSION = 1;
export const DEFAULT_OFFLINE_READING_SNAPSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const DEFAULT_OFFLINE_READING_HISTORY_LIMIT = 200;
export const DEFAULT_OFFLINE_READING_FAVORITES_LIMIT = 300;
export const DEFAULT_OFFLINE_READING_FOCUS_LIMIT = 100;

export interface OfflineReadingHistoryItem {
    newsId: string | number;
    title: string;
    url: string;
    sourceId: SourceID;
    sourceName: string;
    readAt: number;
}

export interface OfflineReadingSnapshotInput {
    history: OfflineReadingHistoryItem[];
    favorites: ReadingStateItem[];
    focusSources: SourceID[];
}

export interface OfflineReadingSnapshot extends OfflineReadingSnapshotInput {
    version: typeof OFFLINE_READING_SNAPSHOT_VERSION;
    savedAt: number;
}

export type OfflineReadingSnapshotState = "fresh" | "stale" | "invalid";

export interface OfflineReadingSnapshotFallbackOptions {
    isOffline: boolean;
    hasPersistedLiveValue: boolean;
    snapshotState: OfflineReadingSnapshotState | "missing";
}

/** Creates a bounded, normalized snapshot that is safe to persist in browser storage. */
export function createOfflineReadingSnapshot(
    input: OfflineReadingSnapshotInput,
    savedAt = Date.now()
): OfflineReadingSnapshot {
    return {
        version: OFFLINE_READING_SNAPSHOT_VERSION,
        savedAt: Number.isFinite(savedAt) && savedAt > 0 ? savedAt : Date.now(),
        history: normalizeOfflineReadingHistory(input.history),
        favorites: normalizeReadingState({ favorites: input.favorites }).favorites.slice(
            0,
            DEFAULT_OFFLINE_READING_FAVORITES_LIMIT
        ),
        focusSources: normalizeOfflineReadingFocusSources(input.focusSources),
    };
}

/**
 * Validates and normalizes stored data at the version boundary.
 * Unknown versions are ignored until an explicit migration is added for them.
 */
export function migrateOfflineReadingSnapshot(value: unknown): OfflineReadingSnapshot | undefined {
    if (!value || typeof value !== "object") return undefined;

    const snapshot = value as Partial<OfflineReadingSnapshot>;
    if (
        snapshot.version !== OFFLINE_READING_SNAPSHOT_VERSION ||
        !Number.isFinite(snapshot.savedAt) ||
        !snapshot.savedAt ||
        !Array.isArray(snapshot.history) ||
        !Array.isArray(snapshot.favorites) ||
        !Array.isArray(snapshot.focusSources)
    ) {
        return undefined;
    }

    return createOfflineReadingSnapshot(
        {
            history: snapshot.history,
            favorites: snapshot.favorites,
            focusSources: snapshot.focusSources,
        },
        snapshot.savedAt
    );
}

/** Distinguishes stale data from malformed data so the UI can explain offline availability honestly. */
export function getOfflineReadingSnapshotState(
    value: unknown,
    now = Date.now(),
    maxAgeMs = DEFAULT_OFFLINE_READING_SNAPSHOT_MAX_AGE_MS
): OfflineReadingSnapshotState {
    const snapshot = migrateOfflineReadingSnapshot(value);
    if (!snapshot || snapshot.savedAt > now + 60 * 1000) return "invalid";
    if (now - snapshot.savedAt > maxAgeMs) return "stale";
    return "fresh";
}

export function isFreshOfflineReadingSnapshot(
    snapshot: OfflineReadingSnapshot,
    now = Date.now(),
    maxAgeMs = DEFAULT_OFFLINE_READING_SNAPSHOT_MAX_AGE_MS
) {
    return getOfflineReadingSnapshotState(snapshot, now, maxAgeMs) === "fresh";
}

/** Chooses the backup only while offline and only when the primary persisted value is unavailable. */
export function shouldUseOfflineReadingSnapshot({
    isOffline,
    hasPersistedLiveValue,
    snapshotState,
}: OfflineReadingSnapshotFallbackOptions) {
    return isOffline && !hasPersistedLiveValue && (snapshotState === "fresh" || snapshotState === "stale");
}

/** Normalizes history with the same URL identity rule used by saved reading state. */
export function normalizeOfflineReadingHistory(
    history: OfflineReadingHistoryItem[],
    limit = DEFAULT_OFFLINE_READING_HISTORY_LIMIT
): OfflineReadingHistoryItem[] {
    const normalizedLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
    const seen = new Set<string>();

    return (Array.isArray(history) ? history : [])
        .filter(isOfflineReadingHistoryItem)
        .map((item) => ({
            ...item,
            title: item.title.trim(),
            url: item.url.trim(),
            sourceName: item.sourceName.trim() || item.sourceId,
            readAt: Number.isFinite(item.readAt) ? item.readAt : 0,
        }))
        .filter((item) => item.title && normalizeReadingStateUrl(item.url))
        .sort(
            (left, right) =>
                right.readAt - left.readAt ||
                normalizeReadingStateUrl(left.url).localeCompare(normalizeReadingStateUrl(right.url))
        )
        .filter((item) => {
            const url = normalizeReadingStateUrl(item.url);
            if (seen.has(url)) return false;
            seen.add(url);
            return true;
        })
        .slice(0, normalizedLimit);
}

export function normalizeOfflineReadingFocusSources(
    focusSources: SourceID[],
    limit = DEFAULT_OFFLINE_READING_FOCUS_LIMIT
): SourceID[] {
    const normalizedLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
    const seen = new Set<string>();

    return (Array.isArray(focusSources) ? focusSources : [])
        .map((source) => (typeof source === "string" ? source.trim() : ""))
        .filter((source) => {
            if (!source || seen.has(source)) return false;
            seen.add(source);
            return true;
        })
        .slice(0, normalizedLimit) as SourceID[];
}

function isOfflineReadingHistoryItem(value: unknown): value is OfflineReadingHistoryItem {
    if (!value || typeof value !== "object") return false;

    const item = value as Partial<OfflineReadingHistoryItem>;
    return (
        (typeof item.newsId === "string" || typeof item.newsId === "number") &&
        typeof item.title === "string" &&
        typeof item.url === "string" &&
        typeof item.sourceId === "string" &&
        typeof item.sourceName === "string" &&
        typeof item.readAt === "number"
    );
}
