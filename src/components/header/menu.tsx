import type { PrimitiveMetadata } from "@shared/types";

import clsx from "clsx";
import { motion } from "framer-motion";
import { useToast } from "~/hooks/useToast";
import { PROJECT_URL } from "@shared/consts";
import { useRef, useState, useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAtom, useSetAtom, useAtomValue } from "jotai";
import { useRelativeTime } from "~/hooks/useRelativeTime";
import { login, logout, useLoginState } from "~/hooks/useLogin";
import { metadataSyncStatusAtom } from "~/atoms/syncStatusAtom";
import { isSyncHubConfigured } from "~/services/synchub.service";
import { syncHubStatusAtom, syncHubRetryRequestAtom } from "~/atoms/syncHubStatusAtom";
import { toErrorStatus, toSuccessStatus, toSyncingStatus } from "@shared/metadata-sync-flow";
import { primitiveMetadataAtom, createDefaultPrimitiveMetadata } from "~/atoms/primitiveMetadataAtom";
import { getSyncHubStatusTone, getSyncHubStatusLabel, getSyncHubStatusDescription } from "@shared/synchub-status";
import {
    getSyncStatusTone,
    getSyncStatusLabel,
    getSyncStatusDescription,
    getSyncTransitionSourceLabel,
} from "@shared/metadata-sync-view";
import {
    uploadMetadata,
    handleAuthError,
    downloadMetadata,
    getSyncErrorMessage,
    mergePrimitiveMetadata,
    markPrimitiveMetadataSynced,
} from "~/services/metadata.service.ts";

import { InstallationGuide } from "./installation-guide";

export function Menu() {
    const { loggedIn, userInfo, enableLogin } = useLoginState();
    const [shown, show] = useState(false);
    const [installationOpen, setInstallationOpen] = useState(false);
    const menuRef = useRef<HTMLSpanElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        if (!shown) return undefined;
        const dismiss = (event: PointerEvent) => {
            if (event.target instanceof Node && !menuRef.current?.contains(event.target)) show(false);
        };
        document.addEventListener("pointerdown", dismiss);
        return () => document.removeEventListener("pointerdown", dismiss);
    }, [shown]);
    const [syncing, setSyncing] = useState(false);
    const navigate = useNavigate();
    const toaster = useToast();
    const [primitiveMetadata, setPrimitiveMetadata] = useAtom(primitiveMetadataAtom);
    const syncStatus = useAtomValue(metadataSyncStatusAtom);
    const setSyncStatus = useSetAtom(metadataSyncStatusAtom);
    const syncHubStatus = useAtomValue(syncHubStatusAtom);
    const requestSyncHubRetry = useSetAtom(syncHubRetryRequestAtom);
    const syncHubConfigured = isSyncHubConfigured();
    const lastSynced = useRelativeTime(syncStatus.lastSyncedAt ?? "");
    const lastAttempt = useRelativeTime(syncStatus.lastAttemptAt ?? "");
    const syncHubLastSynced = useRelativeTime(syncHubStatus.lastSyncedAt ?? "");
    const syncHubLastAttempt = useRelativeTime(syncHubStatus.lastAttemptAt ?? "");

    const hasPendingSyncChanges = loggedIn && primitiveMetadata.action === "manual";

    const handleResetLayout = () => {
        if (!window.confirm("确认重置当前布局到默认配置吗？")) return;

        setPrimitiveMetadata(createDefaultPrimitiveMetadata("manual"));
        toaster(loggedIn ? "布局已重置，稍后会自动同步到云端" : "布局已重置为默认配置", {
            type: "success",
        });
    };

    const goToHealthPage = () => {
        show(false);
        void navigate({ to: "/health" });
    };

    const handleManualSync = async () => {
        if (!loggedIn) {
            login();
            return;
        }

        setSyncing(true);
        setSyncStatus((prev) => toSyncingStatus(prev, "manual-sync"));
        try {
            await uploadMetadata(primitiveMetadata);
            setPrimitiveMetadata((prev: PrimitiveMetadata) => markPrimitiveMetadataSynced(prev));
            setSyncStatus((prev) => toSuccessStatus(prev, "manual-sync"));
            toaster("布局已同步到云端", { type: "success" });
        } catch (error) {
            setSyncStatus((prev) => toErrorStatus(prev, "manual-sync", getSyncErrorMessage(error)));
            if (!handleAuthError(toaster, error)) {
                toaster(getSyncErrorMessage(error), { type: "error" });
            }
        } finally {
            setSyncing(false);
        }
    };

    const handleRetrySync = async () => {
        if (!loggedIn) {
            login();
            return;
        }

        setSyncing(true);
        setSyncStatus((prev) => toSyncingStatus(prev, "retry-sync"));

        try {
            if (primitiveMetadata.action === "manual") {
                await uploadMetadata(primitiveMetadata);
                setPrimitiveMetadata((prev) => markPrimitiveMetadataSynced(prev));
            } else {
                const remote = await downloadMetadata();
                if (remote) {
                    setPrimitiveMetadata((prev) => mergePrimitiveMetadata(prev, remote));
                }
            }

            setSyncStatus((prev) => toSuccessStatus(prev, "retry-sync"));
            toaster("同步已重试并成功", { type: "success" });
        } catch (error) {
            setSyncStatus((prev) => toErrorStatus(prev, "retry-sync", getSyncErrorMessage(error)));
            if (!handleAuthError(toaster, error)) {
                toaster(getSyncErrorMessage(error), { type: "error" });
            }
        } finally {
            setSyncing(false);
        }
    };

    const handleRestoreFromRemote = async () => {
        if (!loggedIn) {
            login();
            return;
        }
        if (!window.confirm("确认使用云端布局覆盖当前本地布局吗？")) return;

        setSyncing(true);
        setSyncStatus((prev) => toSyncingStatus(prev, "restore-from-remote"));

        try {
            const remote = await downloadMetadata();
            if (!remote) {
                toaster("云端暂无可用布局", { type: "info" });
                return;
            }

            setPrimitiveMetadata(remote);
            setSyncStatus((prev) => toSuccessStatus(prev, "restore-from-remote"));
            toaster("已使用云端布局恢复本地配置", { type: "success" });
        } catch (error) {
            setSyncStatus((prev) => toErrorStatus(prev, "restore-from-remote", getSyncErrorMessage(error)));
            if (!handleAuthError(toaster, error)) {
                toaster(getSyncErrorMessage(error), { type: "error" });
            }
        } finally {
            setSyncing(false);
        }
    };

    const handleRestoreToRemote = async () => {
        if (!loggedIn) {
            login();
            return;
        }
        if (!window.confirm("确认使用当前本地布局覆盖云端布局吗？")) return;

        setSyncing(true);
        setSyncStatus((prev) => toSyncingStatus(prev, "restore-to-remote"));

        try {
            await uploadMetadata(primitiveMetadata);
            setPrimitiveMetadata((prev) => markPrimitiveMetadataSynced(prev));
            setSyncStatus((prev) => toSuccessStatus(prev, "restore-to-remote"));
            toaster("已使用本地布局覆盖云端配置", { type: "success" });
        } catch (error) {
            setSyncStatus((prev) => toErrorStatus(prev, "restore-to-remote", getSyncErrorMessage(error)));
            if (!handleAuthError(toaster, error)) {
                toaster(getSyncErrorMessage(error), { type: "error" });
            }
        } finally {
            setSyncing(false);
        }
    };

    const syncStatusLabel = getSyncStatusLabel(syncStatus.phase, hasPendingSyncChanges);

    const syncStatusTone = getSyncStatusTone(syncStatus.phase, hasPendingSyncChanges);

    const syncStatusDescription = getSyncStatusDescription({
        loggedIn,
        phase: syncStatus.phase,
        hasPendingSyncChanges,
        lastSynced,
        lastAttempt,
    });
    const syncTransitionSourceLabel = getSyncTransitionSourceLabel(syncStatus.lastTransitionSource);
    const syncHubStatusLabel = getSyncHubStatusLabel(syncHubStatus.phase);
    const syncHubStatusTone = getSyncHubStatusTone(syncHubStatus.phase);
    const syncHubStatusDescription = getSyncHubStatusDescription({
        status: syncHubStatus,
        lastAttempt: syncHubLastAttempt ?? undefined,
        lastSynced: syncHubLastSynced ?? undefined,
    });

    return (
        <span
            className="header-menu"
            ref={menuRef}
            onKeyDown={(event) => {
                if (event.key === "Escape") {
                    show(false);
                    triggerRef.current?.focus();
                }
            }}
            onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) show(false);
            }}
            onClickCapture={(event) => {
                if (!(event.target instanceof Element)) return;
                const action = event.target.closest("#dropdown-menu button, #dropdown-menu a");
                if (action && !action.hasAttribute("data-open-installation-guide")) {
                    show(false);
                }
            }}
        >
            <span className="flex items-center">
                {enableLogin && loggedIn && userInfo?.avatar ? (
                    <button
                        type="button"
                        ref={triggerRef}
                        onClick={() => show((value) => !value)}
                        aria-expanded={shown}
                        aria-controls={shown ? "dropdown-menu" : undefined}
                        title="打开用户菜单"
                        aria-label="打开用户菜单"
                        className="icon-button user-avatar bg-cover"
                        style={{
                            backgroundImage: `url(${userInfo.avatar}&s=24)`,
                        }}
                    />
                ) : (
                    <button
                        type="button"
                        ref={triggerRef}
                        onClick={() => show((value) => !value)}
                        aria-expanded={shown}
                        aria-controls={shown ? "dropdown-menu" : undefined}
                        title="打开菜单"
                        aria-label="打开菜单"
                        className="icon-button"
                    >
                        <span className="i-ph:dots-three-outline-duotone" aria-hidden="true" />
                    </button>
                )}
            </span>
            {shown && (
                <div className="header-menu-position">
                    <motion.div
                        id="dropdown-menu"
                        className="header-menu-panel"
                        initial={{
                            scale: 0.9,
                        }}
                        animate={{
                            scale: 1,
                        }}
                    >
                        <ol className="header-menu-items">
                            {enableLogin.enable &&
                                (loggedIn ? (
                                    <li>
                                        <button type="button" onClick={logout}>
                                            <span className="i-ph:sign-out-duotone inline-block" />
                                            <span>退出登录</span>
                                        </button>
                                    </li>
                                ) : (
                                    <li>
                                        <button type="button" onClick={login}>
                                            <span className="i-ph:sign-in-duotone inline-block" />
                                            <span>Github 账号登录</span>
                                        </button>
                                    </li>
                                ))}
                            {enableLogin.enable && loggedIn && (
                                <li>
                                    <button type="button" onClick={() => void handleManualSync()}>
                                        <span
                                            className={clsx(
                                                "inline-block",
                                                syncing
                                                    ? "i-ph:spinner-gap-duotone animate-spin"
                                                    : "i-ph:cloud-arrow-up-duotone"
                                            )}
                                        />
                                        <span>
                                            {syncing
                                                ? "同步中"
                                                : hasPendingSyncChanges
                                                  ? "同步待保存更改"
                                                  : syncStatus.phase === "error"
                                                    ? "重试同步"
                                                    : "同步布局"}
                                        </span>
                                    </button>
                                </li>
                            )}
                            {enableLogin.enable && loggedIn && syncStatus.phase === "error" && (
                                <li>
                                    <button type="button" onClick={() => void handleRetrySync()}>
                                        <span className="i-ph:arrows-clockwise-duotone inline-block" />
                                        <span>立即重试同步</span>
                                    </button>
                                </li>
                            )}
                            {enableLogin.enable && loggedIn && (
                                <>
                                    <li>
                                        <button type="button" onClick={() => void handleRestoreFromRemote()}>
                                            <span className="i-ph:cloud-arrow-down-duotone inline-block" />
                                            <span>使用云端恢复本地</span>
                                        </button>
                                    </li>
                                    <li>
                                        <button type="button" onClick={() => void handleRestoreToRemote()}>
                                            <span className="i-ph:cloud-arrow-up-duotone inline-block" />
                                            <span>使用本地覆盖云端</span>
                                        </button>
                                    </li>
                                </>
                            )}
                            {enableLogin.enable && (
                                <li className="block! cursor-default! p-0! [&_*]:cursor-default! hover:bg-transparent!">
                                    <div className="mt-1 rounded-xl bg-neutral-500/6 px-3 py-2 text-xs leading-5">
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="font-medium op-70">布局同步状态</span>
                                            <span className={clsx("rounded-full px-2 py-0.5", syncStatusTone)}>
                                                {syncStatusLabel}
                                            </span>
                                        </div>
                                        <div className="mt-2 op-75">{syncStatusDescription}</div>
                                        <div className="mt-1 op-60">来源：{syncTransitionSourceLabel}</div>
                                        {syncStatus.phase === "error" && syncStatus.lastErrorMessage && (
                                            <div className="mt-2 rounded-lg bg-red-500/8 px-2.5 py-1.5 text-red-600 dark:text-red-300">
                                                {syncStatus.lastErrorMessage}
                                            </div>
                                        )}
                                    </div>
                                </li>
                            )}
                            {syncHubConfigured && syncHubStatus.phase === "error" && (
                                <li>
                                    <button type="button" onClick={() => requestSyncHubRetry((current) => current + 1)}>
                                        <span className="i-ph:arrows-clockwise-duotone inline-block" />
                                        <span>重试 SyncHub</span>
                                    </button>
                                </li>
                            )}
                            {syncHubConfigured && (
                                <li className="block! cursor-default! p-0! [&_*]:cursor-default! hover:bg-transparent!">
                                    <div className="mt-1 rounded-xl bg-neutral-500/6 px-3 py-2 text-xs leading-5">
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="font-medium op-70">SyncHub 后台同步</span>
                                            <span className={clsx("rounded-full px-2 py-0.5", syncHubStatusTone)}>
                                                {syncHubStatusLabel}
                                            </span>
                                        </div>
                                        <div className="mt-2 op-75">{syncHubStatusDescription}</div>
                                        {syncHubStatus.pendingCollections.length > 0 && (
                                            <div className="mt-1 op-60">
                                                待处理 {syncHubStatus.pendingCollections.length} 类数据
                                            </div>
                                        )}
                                    </div>
                                </li>
                            )}
                            <li>
                                <button type="button" onClick={handleResetLayout}>
                                    <span className="i-ph:arrows-counter-clockwise-duotone inline-block" />
                                    <span>重置布局</span>
                                </button>
                            </li>
                            <li className="block! p-0!">
                                <button
                                    type="button"
                                    data-open-installation-guide
                                    onClick={() => {
                                        show(false);
                                        setInstallationOpen(true);
                                    }}
                                >
                                    <span className="i-ph:download-simple-duotone inline-block" aria-hidden="true" />
                                    <span>安装与下载</span>
                                </button>
                            </li>
                            <li>
                                <button type="button" onClick={goToHealthPage}>
                                    <span className="i-ph:heartbeat-duotone inline-block" />
                                    <span>数据源健康</span>
                                </button>
                            </li>
                            {/* <ThemeToggle /> */}
                            <li>
                                <button
                                    type="button"
                                    onClick={() => window.open(PROJECT_URL, "_blank", "noopener,noreferrer")}
                                    className="cursor-pointer [&_*]:cursor-pointer transition-all"
                                >
                                    <span className="i-ph:github-logo-duotone inline-block" />
                                    <span>Star on Github </span>
                                </button>
                            </li>
                            <li className="flex gap-2 items-center">
                                <a href={`${PROJECT_URL}`}>
                                    <img
                                        alt="GitHub stars badge"
                                        src="https://img.shields.io/github/stars/bruceblink/LatestNews?logo=github&style=flat&labelColor=%235e3c40&color=%23614447"
                                    />
                                </a>
                                <a href={`${PROJECT_URL}/fork`}>
                                    <img
                                        alt="GitHub forks badge"
                                        src="https://img.shields.io/github/forks/bruceblink/LatestNews?logo=github&style=flat&labelColor=%235e3c40&color=%23614447"
                                    />
                                </a>
                            </li>
                        </ol>
                    </motion.div>
                </div>
            )}
            <InstallationGuide open={installationOpen} onOpenChange={setInstallationOpen} triggerRef={triggerRef} />
        </span>
    );
}
