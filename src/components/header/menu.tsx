import type { PrimitiveMetadata } from "@shared/types";

import clsx from "clsx"; // function ThemeToggle() {
import { motion } from "framer-motion";
import { useState, useEffect } from "react";
import { useToast } from "~/hooks/useToast";
import { PROJECT_URL } from "@shared/consts";
import { useNavigate } from "@tanstack/react-router";
import { useAtom, useSetAtom, useAtomValue } from "jotai";
import { useRelativeTime } from "~/hooks/useRelativeTime";
import { login, logout, useLoginState } from "~/hooks/useLogin";
import { metadataSyncStatusAtom } from "~/atoms/syncStatusAtom";
import { toErrorStatus, toSuccessStatus, toSyncingStatus } from "@shared/metadata-sync-flow";
import { primitiveMetadataAtom, createDefaultPrimitiveMetadata } from "~/atoms/primitiveMetadataAtom";
import { getSyncStatusTone, getSyncStatusLabel, getSyncStatusDescription } from "@shared/metadata-sync-view";
import {
    uploadMetadata,
    handleAuthError,
    downloadMetadata,
    getSyncErrorMessage,
    mergePrimitiveMetadata,
    markPrimitiveMetadataSynced,
} from "~/services/metadata.service.ts";

// function ThemeToggle() {
//   const { isDark, toggleDark } = useDark()
//   return (
//     <li onClick={toggleDark} className="cursor-pointer [&_*]:cursor-pointer transition-all">
//       <span className={$("inline-block", isDark ? "i-ph-moon-stars-duotone" : "i-ph-sun-dim-duotone")} />
//       <span>
//         {isDark ? "浅色模式" : "深色模式"}
//       </span>
//     </li>
//   )
// }

export function Menu() {
    const { loggedIn, userInfo, enableLogin } = useLoginState();
    const [shown, show] = useState(false);
    const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
    const [syncing, setSyncing] = useState(false);
    const navigate = useNavigate();
    const toaster = useToast();
    const [primitiveMetadata, setPrimitiveMetadata] = useAtom(primitiveMetadataAtom);
    const syncStatus = useAtomValue(metadataSyncStatusAtom);
    const setSyncStatus = useSetAtom(metadataSyncStatusAtom);
    const lastSynced = useRelativeTime(syncStatus.lastSyncedAt ?? "");
    const lastAttempt = useRelativeTime(syncStatus.lastAttemptAt ?? "");

    const hasPendingSyncChanges = loggedIn && primitiveMetadata.action === "manual";

    useEffect(() => {
        const handleBeforeInstallPrompt = (event: Event) => {
            const promptEvent = event as BeforeInstallPromptEvent;
            promptEvent.preventDefault();
            setInstallPrompt(promptEvent);
        };

        const handleAppInstalled = () => {
            setInstallPrompt(null);
            toaster("应用已安装，可以像客户端一样从桌面或主屏启动", { type: "success" });
        };

        window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
        window.addEventListener("appinstalled", handleAppInstalled);

        return () => {
            window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
            window.removeEventListener("appinstalled", handleAppInstalled);
        };
    }, [toaster]);

    const handleResetLayout = () => {
        if (!window.confirm("确认重置当前布局到默认配置吗？")) return;

        setPrimitiveMetadata(createDefaultPrimitiveMetadata("manual"));
        toaster(loggedIn ? "布局已重置，稍后会自动同步到云端" : "布局已重置为默认配置", {
            type: "success",
        });
    };

    const handleInstall = async () => {
        if (!installPrompt) {
            toaster("当前环境暂不支持安装，请使用支持 PWA 安装的浏览器打开", { type: "info" });
            return;
        }

        await installPrompt.prompt();
        const { outcome } = await installPrompt.userChoice;
        setInstallPrompt(null);

        if (outcome === "accepted") {
            toaster("安装请求已确认，稍后可从桌面或主屏启动", { type: "success" });
        }
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
        setSyncStatus((prev) => toSyncingStatus(prev));
        try {
            await uploadMetadata(primitiveMetadata);
            setPrimitiveMetadata((prev: PrimitiveMetadata) => markPrimitiveMetadataSynced(prev));
            setSyncStatus((prev) => toSuccessStatus(prev));
            toaster("布局已同步到云端", { type: "success" });
        } catch (error) {
            setSyncStatus((prev) => toErrorStatus(prev, getSyncErrorMessage(error)));
            toaster(getSyncErrorMessage(error), { type: "error" });
            handleAuthError(toaster, error);
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
        setSyncStatus((prev) => toSyncingStatus(prev));

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

            setSyncStatus((prev) => toSuccessStatus(prev));
            toaster("同步已重试并成功", { type: "success" });
        } catch (error) {
            setSyncStatus((prev) => toErrorStatus(prev, getSyncErrorMessage(error)));
            toaster(getSyncErrorMessage(error), { type: "error" });
            handleAuthError(toaster, error);
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
        setSyncStatus((prev) => toSyncingStatus(prev));

        try {
            const remote = await downloadMetadata();
            if (!remote) {
                toaster("云端暂无可用布局", { type: "info" });
                return;
            }

            setPrimitiveMetadata(remote);
            setSyncStatus((prev) => toSuccessStatus(prev));
            toaster("已使用云端布局恢复本地配置", { type: "success" });
        } catch (error) {
            setSyncStatus((prev) => toErrorStatus(prev, getSyncErrorMessage(error)));
            toaster(getSyncErrorMessage(error), { type: "error" });
            handleAuthError(toaster, error);
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
        setSyncStatus((prev) => toSyncingStatus(prev));

        try {
            await uploadMetadata(primitiveMetadata);
            setPrimitiveMetadata((prev) => markPrimitiveMetadataSynced(prev));
            setSyncStatus((prev) => toSuccessStatus(prev));
            toaster("已使用本地布局覆盖云端配置", { type: "success" });
        } catch (error) {
            setSyncStatus((prev) => toErrorStatus(prev, getSyncErrorMessage(error)));
            toaster(getSyncErrorMessage(error), { type: "error" });
            handleAuthError(toaster, error);
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

    return (
        <span className="relative" onMouseEnter={() => show(true)} onMouseLeave={() => show(false)}>
            <span className="flex items-center scale-90">
                {enableLogin && loggedIn && userInfo?.avatar ? (
                    <button
                        type="button"
                        title="打开用户菜单"
                        aria-label="打开用户菜单"
                        className="h-6 w-6 rounded-full bg-cover"
                        style={{
                            backgroundImage: `url(${userInfo.avatar}&s=24)`,
                        }}
                    />
                ) : (
                    <button
                        type="button"
                        title="打开菜单"
                        aria-label="打开菜单"
                        className="btn i-si:more-muted-horiz-circle-duotone"
                    />
                )}
            </span>
            {shown && (
                <div className="absolute right-0 z-99 bg-transparent pt-4 top-4">
                    <motion.div
                        id="dropdown-menu"
                        className={clsx(["w-200px", "bg-primary backdrop-blur-5 bg-op-70! rounded-lg shadow-xl"])}
                        initial={{
                            scale: 0.9,
                        }}
                        animate={{
                            scale: 1,
                        }}
                    >
                        <ol className="bg-base bg-op-70! backdrop-blur-md p-2 rounded-lg color-base text-base">
                            {enableLogin.enable &&
                                (loggedIn ? (
                                    <li onClick={logout}>
                                        <span className="i-ph:sign-out-duotone inline-block" />
                                        <span>退出登录</span>
                                    </li>
                                ) : (
                                    <li onClick={login}>
                                        <span className="i-ph:sign-in-duotone inline-block" />
                                        <span>Github 账号登录</span>
                                    </li>
                                ))}
                            {enableLogin.enable && loggedIn && (
                                <li onClick={() => void handleManualSync()}>
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
                                </li>
                            )}
                            {enableLogin.enable && loggedIn && syncStatus.phase === "error" && (
                                <li onClick={() => void handleRetrySync()}>
                                    <span className="i-ph:arrows-clockwise-duotone inline-block" />
                                    <span>立即重试同步</span>
                                </li>
                            )}
                            {enableLogin.enable && loggedIn && (
                                <>
                                    <li onClick={() => void handleRestoreFromRemote()}>
                                        <span className="i-ph:cloud-arrow-down-duotone inline-block" />
                                        <span>使用云端恢复本地</span>
                                    </li>
                                    <li onClick={() => void handleRestoreToRemote()}>
                                        <span className="i-ph:cloud-arrow-up-duotone inline-block" />
                                        <span>使用本地覆盖云端</span>
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
                                        {syncStatus.phase === "error" && syncStatus.lastErrorMessage && (
                                            <div className="mt-2 rounded-lg bg-red-500/8 px-2.5 py-1.5 text-red-600 dark:text-red-300">
                                                {syncStatus.lastErrorMessage}
                                            </div>
                                        )}
                                    </div>
                                </li>
                            )}
                            <li onClick={handleResetLayout}>
                                <span className="i-ph:arrows-counter-clockwise-duotone inline-block" />
                                <span>重置布局</span>
                            </li>
                            <li onClick={() => void handleInstall()}>
                                <span className="i-ph:device-mobile-speaker-duotone inline-block" />
                                <span>{installPrompt ? "安装应用" : "安装指引"}</span>
                            </li>
                            <li onClick={goToHealthPage}>
                                <span className="i-ph:heartbeat-duotone inline-block" />
                                <span>数据源健康</span>
                            </li>
                            {/* <ThemeToggle /> */}
                            <li
                                onClick={() => window.open(PROJECT_URL)}
                                className="cursor-pointer [&_*]:cursor-pointer transition-all"
                            >
                                <span className="i-ph:github-logo-duotone inline-block" />
                                <span>Star on Github </span>
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
        </span>
    );
}
