import { latestNewsSyncHubCollections } from "./synchub-contract";

import type { LatestNewsSyncHubCollection } from "./synchub-contract";

export const syncHubPhases = ["idle", "pending", "syncing", "success", "error"] as const;
export const syncHubTransitionSources = ["auto-upload", "retry-upload"] as const;

export type SyncHubPhase = (typeof syncHubPhases)[number];
export type SyncHubTransitionSource = (typeof syncHubTransitionSources)[number];

export interface SyncHubStatus {
    phase: SyncHubPhase;
    pendingCollections: LatestNewsSyncHubCollection[];
    lastAttemptAt?: number;
    lastSyncedAt?: number;
    lastErrorMessage?: string;
    lastTransitionSource?: SyncHubTransitionSource;
}

export function createDefaultSyncHubStatus(): SyncHubStatus {
    return {
        phase: "idle",
        pendingCollections: [],
    };
}

/** Adds locally changed collections to the pending set without duplicating entries. */
export function toSyncHubPendingStatus(
    previous: SyncHubStatus,
    collections: LatestNewsSyncHubCollection[],
    source: SyncHubTransitionSource
): SyncHubStatus {
    return {
        ...previous,
        phase: "pending",
        pendingCollections: mergeCollections(previous.pendingCollections, collections),
        lastErrorMessage: undefined,
        lastTransitionSource: source,
    };
}

/** Marks a concrete batch as in flight and records its attempt time. */
export function toSyncHubSyncingStatus(
    previous: SyncHubStatus,
    collections: LatestNewsSyncHubCollection[],
    source: SyncHubTransitionSource,
    now = Date.now()
): SyncHubStatus {
    return {
        ...previous,
        phase: "syncing",
        pendingCollections: mergeCollections(previous.pendingCollections, collections),
        lastAttemptAt: now,
        lastErrorMessage: undefined,
        lastTransitionSource: source,
    };
}

/**
 * Resolves one upload batch, retaining only failed or newly queued collections.
 * Successful collections advance the last-synced timestamp even when another collection fails.
 */
export function toSyncHubUploadResultStatus(
    previous: SyncHubStatus,
    attempted: LatestNewsSyncHubCollection[],
    failed: LatestNewsSyncHubCollection[],
    source: SyncHubTransitionSource,
    error?: unknown,
    now = Date.now()
): SyncHubStatus {
    const attemptedSet = new Set(attempted);
    const failedSet = new Set(failed);
    const succeeded = attempted.filter((collection) => !failedSet.has(collection));
    const pendingCollections = mergeCollections(
        previous.pendingCollections.filter((collection) => !attemptedSet.has(collection)),
        failed
    );

    if (failed.length > 0) {
        return {
            ...previous,
            phase: "error",
            pendingCollections,
            lastAttemptAt: now,
            ...(succeeded.length > 0 && { lastSyncedAt: now }),
            lastErrorMessage: sanitizeSyncHubError(error),
            lastTransitionSource: source,
        };
    }

    return {
        ...previous,
        phase: pendingCollections.length > 0 ? "pending" : "success",
        pendingCollections,
        lastAttemptAt: now,
        lastSyncedAt: now,
        lastErrorMessage: undefined,
        lastTransitionSource: source,
    };
}

/** Maps untrusted network errors to a small set of user-safe messages. */
export function sanitizeSyncHubError(error: unknown) {
    const message =
        error instanceof Error ? error.message.toLowerCase() : typeof error === "string" ? error.toLowerCase() : "";

    if (/unauth|forbidden|api.?key|\b401\b|\b403\b/.test(message)) {
        return "SyncHub 凭据无效，请重新验证 API Key";
    }
    if (/network|fetch|timeout|timed out|econn|socket|offline/.test(message)) {
        return "无法连接 SyncHub，请检查网络和服务地址";
    }
    return "SyncHub 同步失败，请稍后重试";
}

export function getSyncHubStatusLabel(phase: SyncHubPhase) {
    if (phase === "pending") return "待同步";
    if (phase === "syncing") return "同步中";
    if (phase === "success") return "已同步";
    if (phase === "error") return "同步失败";
    return "未开始";
}

export function getSyncHubStatusTone(phase: SyncHubPhase) {
    if (phase === "success") return "bg-green-500/12 text-green-700 dark:text-green-300";
    if (phase === "error") return "bg-red-500/12 text-red-700 dark:text-red-300";
    if (phase === "syncing") return "bg-cyan-500/12 text-cyan-700 dark:text-cyan-300";
    if (phase === "pending") return "bg-amber-500/12 text-amber-700 dark:text-amber-300";
    return "bg-neutral-500/10 op-70";
}

export function getSyncHubStatusDescription({
    status,
    lastAttempt,
    lastSynced,
}: {
    status: SyncHubStatus;
    lastAttempt?: string;
    lastSynced?: string;
}) {
    if (status.phase === "error") return status.lastErrorMessage ?? "SyncHub 同步失败，请稍后重试";
    if (status.phase === "syncing") return `正在上传 ${status.pendingCollections.length} 类本地数据`;
    if (status.phase === "pending") return `${status.pendingCollections.length} 类本地数据等待上传`;
    if (status.phase === "success") return lastSynced ? `${lastSynced}同步成功` : "最近一次同步成功";
    return lastAttempt ? `${lastAttempt}尝试过同步` : "本地修改会在后台自动同步";
}

function mergeCollections(
    current: LatestNewsSyncHubCollection[],
    incoming: LatestNewsSyncHubCollection[]
): LatestNewsSyncHubCollection[] {
    const selected = new Set([...current, ...incoming]);
    return latestNewsSyncHubCollections.filter((collection) => selected.has(collection));
}
