import { normalizeReadingStateUrl } from "./reading-state";

import type { PrimitiveMetadata } from "./types";

export const DEFAULT_SYNC_HISTORY_LIMIT = 200;
export const DEFAULT_SYNC_FAVORITES_LIMIT = 300;

export type SyncHubColorScheme = "dark" | "light" | "auto";

export interface SyncHubPreferences {
    colorScheme: SyncHubColorScheme;
    metadata: PrimitiveMetadata;
    /** Added after the first SyncHub payload; old documents may omit it. */
    updatedAt?: number;
}

interface UrlRecord {
    url: string;
}

/**
 * Merges local and remote reading history by canonical URL.
 * The newest read timestamp wins; local data wins ties so an older payload cannot erase a local edit.
 */
export function mergeSyncHubReadingHistory<T extends UrlRecord & { readAt: number }>(
    local: T[] | undefined,
    remote: T[] | undefined,
    limit = DEFAULT_SYNC_HISTORY_LIMIT
) {
    return mergeSyncHubUrlRecords(local, remote, (item) => item.readAt, limit);
}

/** Merges favorites as a URL-based union while retaining the newest item metadata for each URL. */
export function mergeSyncHubFavorites<T extends UrlRecord & { updatedAt: number }>(
    local: T[] | undefined,
    remote: T[] | undefined,
    limit = DEFAULT_SYNC_FAVORITES_LIMIT
) {
    return mergeSyncHubUrlRecords(local, remote, (item) => item.updatedAt, limit);
}

/**
 * Merges the three preference concerns independently: metadata uses its own revision timestamp,
 * while color scheme uses the optional preference timestamp with a local-first legacy fallback.
 */
export function mergeSyncHubPreferences(
    local: SyncHubPreferences | undefined,
    remote: Partial<SyncHubPreferences> | undefined
): SyncHubPreferences | undefined {
    if (!local && !remote?.metadata) return undefined;
    if (!local) return remote ? normalizeSyncHubPreferences(remote) : undefined;
    if (!remote) return local;

    const metadata = chooseNewerMetadata(local.metadata, remote.metadata);
    const colorScheme = chooseColorScheme(local, remote);
    const updatedAt = chooseLatestTimestamp(local.updatedAt, remote.updatedAt);

    return {
        colorScheme,
        metadata,
        ...(updatedAt !== undefined && { updatedAt }),
    };
}

function mergeSyncHubUrlRecords<T extends UrlRecord>(
    local: T[] | undefined,
    remote: T[] | undefined,
    getTimestamp: (item: T) => number,
    limit: number
) {
    const records = new Map<string, { item: T; timestamp: number; local: boolean }>();

    for (const item of remote ?? []) {
        addRecord(records, item, getTimestamp(item), false);
    }
    for (const item of local ?? []) {
        addRecord(records, item, getTimestamp(item), true);
    }

    const normalizedLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
    return [...records.entries()]
        .sort(
            ([leftUrl, left], [rightUrl, right]) => right.timestamp - left.timestamp || leftUrl.localeCompare(rightUrl)
        )
        .slice(0, normalizedLimit)
        .map(([, record]) => record.item);
}

function addRecord<T extends UrlRecord>(
    records: Map<string, { item: T; timestamp: number; local: boolean }>,
    item: T,
    timestamp: number,
    local: boolean
) {
    if (typeof item.url !== "string") return;
    const normalizedUrl = normalizeReadingStateUrl(item.url);
    if (!normalizedUrl) return;
    const normalizedTimestamp = Number.isFinite(timestamp) ? timestamp : 0;

    const current = records.get(normalizedUrl);
    if (
        !current ||
        normalizedTimestamp > current.timestamp ||
        (normalizedTimestamp === current.timestamp && local && !current.local)
    ) {
        records.set(normalizedUrl, { item, timestamp: normalizedTimestamp, local });
    }
}

function chooseNewerMetadata(local: PrimitiveMetadata, remote: PrimitiveMetadata | undefined) {
    if (!remote || remote.updatedTime <= local.updatedTime) return local;
    return remote;
}

function chooseColorScheme(local: SyncHubPreferences, remote: Partial<SyncHubPreferences>) {
    if (isColorScheme(remote.colorScheme)) {
        if (remote.updatedAt !== undefined && local.updatedAt !== undefined) {
            return remote.updatedAt > local.updatedAt ? remote.colorScheme : local.colorScheme;
        }
        if (remote.updatedAt !== undefined && local.updatedAt === undefined) return remote.colorScheme;
    }

    return local.colorScheme;
}

function normalizeSyncHubPreferences(remote: Partial<SyncHubPreferences>): SyncHubPreferences {
    return {
        colorScheme: isColorScheme(remote.colorScheme) ? remote.colorScheme : "dark",
        metadata: remote.metadata as PrimitiveMetadata,
        ...(remote.updatedAt !== undefined && { updatedAt: remote.updatedAt }),
    };
}

function chooseLatestTimestamp(local: number | undefined, remote: number | undefined) {
    if (local === undefined) return remote;
    if (remote === undefined) return local;
    return Math.max(local, remote);
}

function isColorScheme(value: unknown): value is SyncHubColorScheme {
    return value === "dark" || value === "light" || value === "auto";
}
