import type { MetadataSyncPhase } from "./metadata-sync-types";

export function getSyncStatusLabel(phase: MetadataSyncPhase, hasPendingSyncChanges: boolean) {
    if (phase === "syncing") return "同步中";
    if (phase === "queued") return "待同步";
    if (phase === "merged") return "已合并";
    if (phase === "conflict-resolved") return "已调和";
    if (hasPendingSyncChanges) return "待同步";
    if (phase === "error") return "同步失败";
    if (phase === "success") return "已同步";
    return "未同步";
}

export function getSyncStatusTone(phase: MetadataSyncPhase, hasPendingSyncChanges: boolean) {
    if (phase === "syncing") return "text-primary-700 bg-primary/10 dark:text-primary-300";
    if (phase === "queued" || hasPendingSyncChanges) return "text-amber-700 bg-amber-500/12 dark:text-amber-300";
    if (phase === "merged" || phase === "conflict-resolved") return "text-cyan-700 bg-cyan-500/12 dark:text-cyan-300";
    if (phase === "error") return "text-red-700 bg-red-500/12 dark:text-red-300";
    if (phase === "success") return "text-green-700 bg-green-500/12 dark:text-green-300";
    return "text-neutral-600 bg-neutral-500/8 dark:text-neutral-300";
}

export function getSyncStatusDescription({
    loggedIn,
    phase,
    hasPendingSyncChanges,
    lastSynced,
    lastAttempt,
}: {
    loggedIn: boolean;
    phase: MetadataSyncPhase;
    hasPendingSyncChanges: boolean;
    lastSynced?: string | null;
    lastAttempt?: string | null;
}) {
    if (!loggedIn) return "登录后可在多端同步布局配置";
    if (hasPendingSyncChanges) return "本地布局有新改动，等待同步到云端";
    if (phase === "queued") return "检测到布局改动，准备发起同步";
    if (phase === "syncing") return "正在和云端同步当前布局";
    if (phase === "merged") return "本地与云端布局已完成合并";
    if (phase === "conflict-resolved") return "本地与云端差异已自动调和";
    if (phase === "success") return `最近同步 ${lastSynced ?? "刚刚"}`;
    if (phase === "error") return `最近尝试 ${lastAttempt ?? "刚刚"}`;
    return "还没有同步记录";
}
