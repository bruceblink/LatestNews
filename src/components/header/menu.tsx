import type { MouseEvent } from "react";

import clsx from "clsx";
import { motion } from "framer-motion";
import { useDark } from "~/hooks/useDark";
import { useToast } from "~/hooks/useToast";
import { PROJECT_URL } from "@shared/consts";
import { useSearchBar } from "~/hooks/useSearch";
import { useRef, useState, useEffect } from "react";
import { useAtom, useSetAtom, useAtomValue } from "jotai";
import { useRelativeTime } from "~/hooks/useRelativeTime";
import { syncMetadataAtom } from "~/atoms/syncMetadataAtom";
import { Link, useRouterState } from "@tanstack/react-router";
import { metadataSyncStatusAtom } from "~/atoms/syncStatusAtom";
import { isSyncHubConfigured } from "~/services/synchub.service";
import { appNavigation, columnNavigation } from "@shared/app-navigation";
import { handleAuthError, getSyncErrorMessage } from "~/services/metadata.service";
import { syncHubStatusAtom, syncHubRetryRequestAtom } from "~/atoms/syncHubStatusAtom";
import { login, logout, useLoginState, retryEnableLoginCheckAtom } from "~/hooks/useLogin";
import { primitiveMetadataAtom, createDefaultPrimitiveMetadata } from "~/atoms/primitiveMetadataAtom";
import { getSyncHubStatusTone, getSyncHubStatusLabel, getSyncHubStatusDescription } from "@shared/synchub-status";
import {
    getSyncStatusTone,
    getSyncStatusLabel,
    getSyncStatusDescription,
    getSyncTransitionSourceLabel,
} from "@shared/metadata-sync-view";

import { InstallationGuide } from "./installation-guide";

function getSafeAvatarUrl(value: string | undefined) {
    if (!value) return undefined;
    try {
        const url = new URL(value);
        if (url.protocol !== "https:") return undefined;
        return url.href;
    } catch {
        return undefined;
    }
}

function getAccountInitial(username: string) {
    return Array.from(username.trim())[0]?.toLocaleUpperCase() ?? "?";
}

type MenuVariant = "default" | "account";
type MobileExtraItem = "search" | "columns" | "settings" | "installation" | "theme";
type DesktopExtraItem = "settings" | "installation" | "theme";

interface MenuProps {
    includeRepositoryActions?: boolean;
    variant?: MenuVariant;
    showSettings?: boolean;
    showInstallation?: boolean;
    desktopExtraItems?: DesktopExtraItem[];
    mobileExtraItems?: MobileExtraItem[];
}

export function Menu({
    includeRepositoryActions = true,
    variant = "default",
    showSettings = true,
    showInstallation = true,
    desktopExtraItems = [],
    mobileExtraItems = [],
}: MenuProps = {}) {
    const {
        loading: authLoading,
        loggedIn,
        userInfo,
        enableLogin,
        enableLoginLoading,
        enableLoginError,
    } = useLoginState();
    const [shown, show] = useState(false);
    const [installationOpen, setInstallationOpen] = useState(false);
    const [avatarFailed, setAvatarFailed] = useState(false);
    const menuRef = useRef<HTMLSpanElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const installationTriggerRef = useRef<HTMLButtonElement | null>(null);
    const pathname = useRouterState({ select: (state) => state.location.pathname });
    const { toggle: toggleSearch } = useSearchBar();
    const { isDark, toggleDark } = useDark();
    const isAccountVariant = variant === "account";
    const menuId = isAccountVariant ? "account-dropdown" : "dropdown-menu";
    const safeAvatar = getSafeAvatarUrl(userInfo?.avatar);
    const username = userInfo?.username.trim() || "账户";
    const previousPathname = useRef(pathname);
    const accountState =
        enableLoginLoading || authLoading
            ? "loading"
            : enableLoginError
              ? "error"
              : !enableLogin.enable
                ? "disabled"
                : loggedIn
                  ? "authenticated"
                  : "unauthenticated";
    const authenticated = accountState === "authenticated";
    const canUseLogin = authenticated || accountState === "unauthenticated";

    useEffect(() => {
        setAvatarFailed(false);
    }, [safeAvatar]);

    useEffect(() => {
        if (!shown) return undefined;
        const dismiss = (event: PointerEvent) => {
            if (event.target instanceof Node && !menuRef.current?.contains(event.target)) show(false);
        };
        document.addEventListener("pointerdown", dismiss);
        return () => document.removeEventListener("pointerdown", dismiss);
    }, [shown]);
    useEffect(() => {
        if (previousPathname.current === pathname) return;
        previousPathname.current = pathname;
        if (!shown) return;
        show(false);
        triggerRef.current?.focus();
    }, [pathname, shown]);
    const toaster = useToast();
    const [primitiveMetadata, setPrimitiveMetadata] = useAtom(primitiveMetadataAtom);
    const syncStatus = useAtomValue(metadataSyncStatusAtom);
    const syncMetadata = useSetAtom(syncMetadataAtom);
    const syncing = syncStatus.phase === "syncing";
    const syncHubStatus = useAtomValue(syncHubStatusAtom);
    const requestSyncHubRetry = useSetAtom(syncHubRetryRequestAtom);
    const retryEnableLoginCheck = useSetAtom(retryEnableLoginCheckAtom);
    const syncHubConfigured = isSyncHubConfigured();
    const lastSynced = useRelativeTime(syncStatus.lastSyncedAt ?? "");
    const lastAttempt = useRelativeTime(syncStatus.lastAttemptAt ?? "");
    const syncHubLastSynced = useRelativeTime(syncHubStatus.lastSyncedAt ?? "");
    const syncHubLastAttempt = useRelativeTime(syncHubStatus.lastAttemptAt ?? "");

    const hasPendingSyncChanges = loggedIn && primitiveMetadata.action === "manual";

    const handleResetLayout = () => {
        if (!window.confirm("确认重置当前布局到默认配置吗？")) return;

        setPrimitiveMetadata(createDefaultPrimitiveMetadata("manual"));
        toaster("布局已重置为默认配置", { type: "success" });
    };

    const handleLayoutSync = async (
        source: "manual-sync" | "retry-sync" | "restore-from-remote" | "restore-to-remote",
        successMessage: string,
        confirmation?: string
    ) => {
        if (!loggedIn) {
            login();
            return;
        }
        if (confirmation && !window.confirm(confirmation)) return;

        try {
            const result = await syncMetadata(source);
            if (result === "synced") toaster(successMessage, { type: "success" });
            if (result === "empty") toaster("云端暂无可用布局", { type: "info" });
            if (result === "pending") toaster("布局在同步期间已更改，请检查当前布局后重试", { type: "info" });
        } catch (error) {
            if (!handleAuthError(toaster, error)) toaster(getSyncErrorMessage(error), { type: "error" });
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
    const accountStatusLabel =
        accountState === "loading"
            ? "正在检查登录状态"
            : accountState === "disabled"
              ? "账户不可用"
              : accountState === "error"
                ? "登录状态暂不可用"
                : accountState === "authenticated"
                  ? "已登录"
                  : "未登录";
    const accountTriggerLabel =
        accountState === "loading"
            ? "正在检查登录状态"
            : accountState === "disabled"
              ? "账户不可用"
              : accountState === "error"
                ? "登录状态暂不可用"
                : accountState === "authenticated"
                  ? `打开用户菜单：${username}`
                  : "使用 GitHub 登录";

    const openInstallationGuide = (event?: MouseEvent<HTMLButtonElement>) => {
        if (event) installationTriggerRef.current = shown ? triggerRef.current : event.currentTarget;
        show(false);
        setInstallationOpen(true);
    };

    const accountExtra = (item: MobileExtraItem, desktop = false) => {
        const itemClass = desktop ? "app-shell-tool" : isAccountVariant ? "app-mobile-account-extra" : "app-shell-tool";
        switch (item) {
            case "search":
                return (
                    <button
                        key={item}
                        type="button"
                        className={itemClass}
                        onClick={() => {
                            show(false);
                            toggleSearch(true);
                        }}
                    >
                        <span className="i-ph:magnifying-glass" aria-hidden="true" />
                        <span>搜索来源</span>
                    </button>
                );
            case "columns":
                return columnNavigation.map((column) => (
                    <Link
                        key={column.id}
                        to="/c/$column"
                        params={{ column: column.id }}
                        className={itemClass}
                        onClick={() => show(false)}
                    >
                        <span className={column.icon} aria-hidden="true" />
                        <span>{column.label}</span>
                    </Link>
                ));
            case "settings":
                return (
                    <Link key={item} to={appNavigation.settings.path} className={itemClass} onClick={() => show(false)}>
                        <span className={appNavigation.settings.icon} aria-hidden="true" />
                        <span>{appNavigation.settings.label}</span>
                    </Link>
                );
            case "installation":
                if (!showInstallation) return null;
                return (
                    <button
                        key={item}
                        type="button"
                        className={itemClass}
                        data-open-installation-guide
                        onClick={(event) => openInstallationGuide(event)}
                    >
                        <span className="i-ph:download-simple" aria-hidden="true" />
                        <span>安装与下载</span>
                    </button>
                );
            case "theme":
                return (
                    <button key={item} type="button" className={itemClass} onClick={toggleDark}>
                        <span className={isDark ? "i-ph:sun" : "i-ph:moon-stars"} aria-hidden="true" />
                        <span>{isDark ? "切换到浅色主题" : "切换到深色主题"}</span>
                    </button>
                );
            default:
                return null;
        }
    };

    return (
        <span
            className={clsx("header-menu", isAccountVariant && "app-shell-account")}
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
            onClick={(event) => {
                if (!(event.target instanceof Element)) return;
                const action = event.target.closest(`#${menuId} button, #${menuId} a`);
                if (action && !action.hasAttribute("data-open-installation-guide")) {
                    show(false);
                    triggerRef.current?.focus();
                }
            }}
        >
            {!!desktopExtraItems.length && (
                <div className="app-shell-account-desktop-tools">
                    {desktopExtraItems.map((item) => accountExtra(item, true))}
                </div>
            )}
            {isAccountVariant ? (
                <button
                    type="button"
                    ref={triggerRef}
                    className="app-shell-account-trigger"
                    onClick={() => show((value) => !value)}
                    aria-expanded={shown}
                    aria-controls={shown ? menuId : undefined}
                    aria-label={accountTriggerLabel}
                    aria-busy={accountState === "loading"}
                >
                    {accountState === "authenticated" && (
                        <>
                            <span className="app-shell-account-avatar">
                                {safeAvatar && !avatarFailed ? (
                                    <img
                                        src={safeAvatar}
                                        alt=""
                                        referrerPolicy="no-referrer"
                                        onError={() => setAvatarFailed(true)}
                                    />
                                ) : (
                                    <span className="app-shell-account-fallback" aria-hidden="true">
                                        {getAccountInitial(username)}
                                    </span>
                                )}
                            </span>
                            <span className="app-shell-account-copy">
                                <strong>{username}</strong>
                                {userInfo?.email && <span>{userInfo.email}</span>}
                                <span className="app-shell-account-status">{accountStatusLabel}</span>
                            </span>
                        </>
                    )}
                    {accountState !== "authenticated" && (
                        <>
                            <span className="app-shell-account-avatar" aria-hidden="true">
                                <span className="i-ph:user-circle" />
                            </span>
                            <span className="app-shell-account-copy">
                                <strong>
                                    {accountState === "loading"
                                        ? "账户"
                                        : accountState === "disabled"
                                          ? "账户同步"
                                          : "账户"}
                                </strong>
                                <span className="app-shell-account-status">{accountStatusLabel}</span>
                            </span>
                        </>
                    )}
                    <span className="i-ph:dots-three" aria-hidden="true" />
                </button>
            ) : (
                <span className="flex items-center">
                    <button
                        type="button"
                        ref={triggerRef}
                        onClick={() => show((value) => !value)}
                        aria-expanded={shown}
                        aria-controls={shown ? menuId : undefined}
                        title="打开菜单"
                        aria-label="打开菜单"
                        className="icon-button"
                    >
                        <span className="i-ph:dots-three-outline-duotone" aria-hidden="true" />
                    </button>
                </span>
            )}
            {shown && (
                <div className="header-menu-position">
                    <motion.div
                        id={menuId}
                        className={clsx("header-menu-panel", isAccountVariant && "app-shell-account-panel")}
                        initial={{
                            scale: 0.9,
                        }}
                        animate={{
                            scale: 1,
                        }}
                    >
                        {isAccountVariant && (
                            <div className="app-shell-account-heading">
                                <strong>{authenticated ? username : "账户"}</strong>
                                {authenticated && userInfo?.email && <span>{userInfo.email}</span>}
                                <span className="app-shell-account-status">{accountStatusLabel}</span>
                            </div>
                        )}
                        <ol className="header-menu-items">
                            {!!mobileExtraItems.length && (
                                <li className="app-mobile-account-extras">
                                    {mobileExtraItems.map((item) => accountExtra(item))}
                                </li>
                            )}
                            {canUseLogin &&
                                (authenticated ? (
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
                                            <span>使用 GitHub 登录</span>
                                        </button>
                                    </li>
                                ))}
                            {accountState === "error" && (
                                <li>
                                    <button
                                        type="button"
                                        disabled={enableLoginLoading}
                                        aria-busy={enableLoginLoading}
                                        onClick={() => void retryEnableLoginCheck()}
                                    >
                                        <span className="i-ph:arrows-clockwise-duotone inline-block" />
                                        <span>重新检查登录状态</span>
                                    </button>
                                </li>
                            )}
                            {authenticated && (
                                <li>
                                    <button
                                        type="button"
                                        disabled={syncing}
                                        aria-busy={syncing}
                                        onClick={() => void handleLayoutSync("manual-sync", "布局已同步到云端")}
                                    >
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
                            {authenticated && syncStatus.phase === "error" && (
                                <li>
                                    <button
                                        type="button"
                                        disabled={syncing}
                                        aria-busy={syncing}
                                        onClick={() => void handleLayoutSync("retry-sync", "同步已重试并成功")}
                                    >
                                        <span className="i-ph:arrows-clockwise-duotone inline-block" />
                                        <span>立即重试同步</span>
                                    </button>
                                </li>
                            )}
                            {authenticated && (
                                <>
                                    <li>
                                        <button
                                            type="button"
                                            disabled={syncing}
                                            aria-busy={syncing}
                                            onClick={() =>
                                                void handleLayoutSync(
                                                    "restore-from-remote",
                                                    "已使用云端布局恢复本地配置",
                                                    "确认使用云端布局覆盖当前本地布局吗？"
                                                )
                                            }
                                        >
                                            <span className="i-ph:cloud-arrow-down-duotone inline-block" />
                                            <span>使用云端恢复本地</span>
                                        </button>
                                    </li>
                                    <li>
                                        <button
                                            type="button"
                                            disabled={syncing}
                                            aria-busy={syncing}
                                            onClick={() =>
                                                void handleLayoutSync(
                                                    "restore-to-remote",
                                                    "已使用本地布局覆盖云端配置",
                                                    "确认使用当前本地布局覆盖云端布局吗？"
                                                )
                                            }
                                        >
                                            <span className="i-ph:cloud-arrow-up-duotone inline-block" />
                                            <span>使用本地覆盖云端</span>
                                        </button>
                                    </li>
                                </>
                            )}
                            {authenticated && (
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
                            {showInstallation && !desktopExtraItems.includes("installation") && (
                                <li className="block! p-0!">
                                    <button
                                        type="button"
                                        data-open-installation-guide
                                        ref={installationTriggerRef}
                                        onClick={openInstallationGuide}
                                    >
                                        <span
                                            className="i-ph:download-simple-duotone inline-block"
                                            aria-hidden="true"
                                        />
                                        <span>安装与下载</span>
                                    </button>
                                </li>
                            )}
                            {showSettings && (
                                <li>
                                    <Link to={appNavigation.settings.path} className="header-menu-link">
                                        <span className={appNavigation.settings.icon} aria-hidden="true" />
                                        <span>{appNavigation.settings.label}</span>
                                    </Link>
                                </li>
                            )}
                            {includeRepositoryActions && (
                                <>
                                    <li>
                                        <button
                                            type="button"
                                            onClick={() => window.open(PROJECT_URL, "_blank", "noopener,noreferrer")}
                                            className="cursor-pointer [&_*]:cursor-pointer transition-all"
                                        >
                                            <span className="i-ph:github-logo-duotone inline-block" />
                                            <span>打开 GitHub 仓库</span>
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
                                </>
                            )}
                        </ol>
                    </motion.div>
                </div>
            )}
            <InstallationGuide
                open={installationOpen}
                onOpenChange={setInstallationOpen}
                triggerRef={installationTriggerRef}
            />
        </span>
    );
}
