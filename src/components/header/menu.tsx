import type { PrimitiveMetadata } from "@shared/types";

import clsx from "clsx"; // function ThemeToggle() {
import { motion } from "framer-motion";
import { useState, useEffect } from "react";
import { useToast } from "~/hooks/useToast";
import { PROJECT_URL } from "@shared/consts";
import { useAtom, useAtomValue } from "jotai";
import { useNavigate } from "@tanstack/react-router";
import { useRelativeTime } from "~/hooks/useRelativeTime";
import { login, logout, useLoginState } from "~/hooks/useLogin";
import { metadataSyncStatusAtom } from "~/atoms/syncStatusAtom";
import { primitiveMetadataAtom, createDefaultPrimitiveMetadata } from "~/atoms/primitiveMetadataAtom";
import {
    uploadMetadata,
    handleAuthError,
    getSyncErrorMessage,
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
        try {
            await uploadMetadata(primitiveMetadata);
            setPrimitiveMetadata((prev: PrimitiveMetadata) => markPrimitiveMetadataSynced(prev));
            toaster("布局已同步到云端", { type: "success" });
        } catch (error) {
            toaster(getSyncErrorMessage(error), { type: "error" });
            handleAuthError(toaster, error);
        } finally {
            setSyncing(false);
        }
    };

    const syncStatusLabel =
        syncStatus.phase === "syncing"
            ? "同步中"
            : syncStatus.phase === "queued"
              ? "待同步"
              : syncStatus.phase === "merged"
                ? "已合并"
                : syncStatus.phase === "conflict-resolved"
                  ? "已调和"
                  : hasPendingSyncChanges
                    ? "待同步"
                    : syncStatus.phase === "error"
                      ? "同步失败"
                      : syncStatus.phase === "success"
                        ? "已同步"
                        : "未同步";

    const syncStatusTone =
        syncStatus.phase === "syncing"
            ? "text-primary-700 bg-primary/10 dark:text-primary-300"
            : syncStatus.phase === "queued" || hasPendingSyncChanges
              ? "text-amber-700 bg-amber-500/12 dark:text-amber-300"
              : syncStatus.phase === "merged" || syncStatus.phase === "conflict-resolved"
                ? "text-cyan-700 bg-cyan-500/12 dark:text-cyan-300"
                : syncStatus.phase === "error"
                  ? "text-red-700 bg-red-500/12 dark:text-red-300"
                  : syncStatus.phase === "success"
                    ? "text-green-700 bg-green-500/12 dark:text-green-300"
                    : "text-neutral-600 bg-neutral-500/8 dark:text-neutral-300";

    const syncStatusDescription = !loggedIn
        ? "登录后可在多端同步布局配置"
        : hasPendingSyncChanges
          ? "本地布局有新改动，等待同步到云端"
          : syncStatus.phase === "queued"
            ? "检测到布局改动，准备发起同步"
            : syncStatus.phase === "syncing"
              ? "正在和云端同步当前布局"
              : syncStatus.phase === "merged"
                ? "本地与云端布局已完成合并"
                : syncStatus.phase === "conflict-resolved"
                  ? "本地与云端差异已自动调和"
                  : syncStatus.phase === "success"
                    ? `最近同步 ${lastSynced ?? "刚刚"}`
                    : syncStatus.phase === "error"
                      ? `最近尝试 ${lastAttempt ?? "刚刚"}`
                      : "还没有同步记录";

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
