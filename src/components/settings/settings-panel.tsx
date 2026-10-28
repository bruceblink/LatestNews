import type { FormEvent } from "react";
import type { DesktopCollectionMode } from "@shared/desktop-collection-mode";

import { useAtom } from "jotai";
import { useState, useEffect } from "react";
import { useToast } from "~/hooks/useToast";
import { colorSchemeAtom } from "~/hooks/useDark";
import {
    resetDesktopNewsApiUrl,
    readDesktopPreferences,
    saveDesktopNewsApiSettings,
    readDesktopNewsApiSettings,
    type DesktopNewsApiSettings,
    isDesktopNewsApiConfigurable,
    saveDesktopTrayBackgroundEnabled,
    isDesktopTrayBackgroundConfigurable,
} from "~/services/desktop-settings.service";

interface SettingsPanelProps {
    showTitle?: boolean;
}

/** Shared settings surface used by the standalone header button and the settings route. */
export function SettingsPanel({ showTitle = true }: SettingsPanelProps) {
    const toaster = useToast();
    const [colorScheme, setColorScheme] = useAtom(colorSchemeAtom);
    const desktopBuild = import.meta.env.LATESTNEWS_DESKTOP === true;
    const configurable = desktopBuild && isDesktopNewsApiConfigurable();
    const trayConfigurable = desktopBuild && isDesktopTrayBackgroundConfigurable();
    const [settings, setSettings] = useState<DesktopNewsApiSettings>();
    const [url, setUrl] = useState("");
    const [mode, setMode] = useState<DesktopCollectionMode>("auto");
    const [trayBackgroundEnabled, setTrayBackgroundEnabled] = useState(false);
    const [loading, setLoading] = useState(configurable);
    const [saving, setSaving] = useState(false);
    const [traySaving, setTraySaving] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string>();
    const [trayErrorMessage, setTrayErrorMessage] = useState<string>();

    useEffect(() => {
        let cancelled = false;
        if (configurable) {
            void readDesktopNewsApiSettings()
                .then((next) => {
                    if (cancelled) return;
                    setSettings(next);
                    setUrl(next.url);
                    setMode(next.mode);
                })
                .catch((error: unknown) => {
                    if (cancelled) return;
                    setErrorMessage(error instanceof Error ? error.message : "无法读取桌面 API 配置。");
                })
                .finally(() => {
                    if (!cancelled) setLoading(false);
                });
        }

        return () => {
            cancelled = true;
        };
    }, [configurable]);

    useEffect(() => {
        let cancelled = false;
        if (trayConfigurable) {
            void readDesktopPreferences()
                .then((preferences) => {
                    if (!cancelled) setTrayBackgroundEnabled(preferences.trayBackgroundEnabled);
                })
                .catch((error: unknown) => {
                    if (!cancelled) {
                        setTrayErrorMessage(error instanceof Error ? error.message : "无法读取桌面偏好设置。");
                    }
                });
        }
        return () => {
            cancelled = true;
        };
    }, [trayConfigurable]);

    const handleSave = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setSaving(true);
        setErrorMessage(undefined);
        if (mode === "remote" && !url.trim()) {
            setErrorMessage("远端模式需要配置数据源 API 地址。");
            setSaving(false);
            return;
        }
        try {
            await saveDesktopNewsApiSettings(url, mode);
            toaster("数据源设置已保存，页面即将刷新", { type: "success" });
            window.setTimeout(() => window.location.reload(), 150);
        } catch (error) {
            setErrorMessage(error instanceof Error ? error.message : "保存数据源 API 地址失败。");
            setSaving(false);
        }
    };

    const handleReset = async () => {
        if (!settings || !window.confirm("确认恢复构建时的数据源 API 地址吗？")) return;
        setSaving(true);
        setErrorMessage(undefined);
        try {
            await resetDesktopNewsApiUrl();
            toaster("已恢复默认数据源 API 地址，页面即将刷新", { type: "success" });
            window.setTimeout(() => window.location.reload(), 150);
        } catch (error) {
            setErrorMessage(error instanceof Error ? error.message : "恢复默认数据源 API 地址失败。");
            setSaving(false);
        }
    };

    const handleTrayBackgroundChange = async (enabled: boolean) => {
        setTraySaving(true);
        setTrayErrorMessage(undefined);
        try {
            const preferences = await saveDesktopTrayBackgroundEnabled(enabled);
            setTrayBackgroundEnabled(preferences.trayBackgroundEnabled);
            toaster(enabled ? "托盘后台模式已启用。关闭主窗口后，应用仍会刷新本地来源。" : "托盘后台模式已关闭。", {
                type: "success",
            });
        } catch (error) {
            setTrayErrorMessage(error instanceof Error ? error.message : "保存托盘后台设置失败。");
        } finally {
            setTraySaving(false);
        }
    };

    return (
        <section className="settings-panel space-y-5">
            {showTitle && (
                <div>
                    <h1 className="m-0 text-2xl font-semibold text-zinc-800 dark:text-zinc-100">设置</h1>
                    <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                        Web 和桌面端使用同一套配置面板。桌面端可以选择数据读取方式；登录服务和 SyncHub 不受影响。
                    </p>
                </div>
            )}

            <section className="settings-group" aria-labelledby="appearance-title">
                <div className="settings-group-heading">
                    <span className="i-ph:palette-duotone" aria-hidden="true" />
                    <div>
                        <h2 id="appearance-title">外观主题</h2>
                        <p>选择适合你的阅读氛围。</p>
                    </div>
                </div>
                <div className="theme-options" role="group" aria-label="外观主题">
                    {(
                        [
                            { id: "light", label: "浅色", icon: "i-ph:sun-duotone" },
                            { id: "dark", label: "深色", icon: "i-ph:moon-stars-duotone" },
                            { id: "auto", label: "跟随系统", icon: "i-ph:desktop-duotone" },
                        ] as const
                    ).map((theme) => (
                        <button
                            type="button"
                            key={theme.id}
                            className="theme-option"
                            aria-pressed={colorScheme === theme.id}
                            onClick={() => setColorScheme(theme.id)}
                        >
                            <span className={`theme-preview theme-preview-${theme.id}`} aria-hidden="true">
                                <span />
                                <span />
                                <span />
                            </span>
                            <span className="theme-option-label">
                                <span className={theme.icon} aria-hidden="true" />
                                {theme.label}
                                <span className="theme-check i-ph:check-circle-fill" aria-hidden="true" />
                            </span>
                        </button>
                    ))}
                </div>
            </section>
            {!desktopBuild && (
                <div className="settings-info">
                    当前运行在 Web 版本。数据源地址由构建变量 <code>VITE_NEWS_API_URL</code>{" "}
                    决定；桌面版本可以在此面板保存自定义地址。
                </div>
            )}

            {desktopBuild && !configurable && (
                <div className="rounded-2xl bg-amber-500/10 p-5 text-sm leading-6 text-amber-800 dark:text-amber-200">
                    当前桌面构建没有启用 API 地址配置接口，请重新构建桌面应用后再试。
                </div>
            )}

            {configurable && (
                <form
                    className="settings-group"
                    aria-busy={loading || saving}
                    onSubmit={(event) => void handleSave(event)}
                >
                    <label className="block text-sm font-medium" htmlFor="desktop-news-api-url">
                        数据源 API URL
                    </label>
                    <input
                        id="desktop-news-api-url"
                        type="url"
                        value={url}
                        onChange={(event) => setUrl(event.target.value)}
                        placeholder="https://news.example.com"
                        autoComplete="off"
                        aria-describedby="desktop-news-api-url-help"
                        aria-invalid={Boolean(errorMessage)}
                        disabled={loading || saving}
                        className="mt-2 w-full rounded-xl border border-neutral-500/20 bg-base px-3 py-2.5 text-sm outline-none transition-colors focus:border-cyan-500/60"
                    />
                    <p id="desktop-news-api-url-help" className="mt-2 text-xs leading-5 op-65">
                        只填写服务根地址，例如 <code>https://news.example.com</code>。应用会自动请求该地址下的{" "}
                        <code>/api</code> 路径。生产构建要求 HTTPS；本地开发允许 localhost HTTP。
                    </p>

                    <label className="mt-5 block text-sm font-medium" htmlFor="desktop-news-api-mode">
                        采集模式
                    </label>
                    <select
                        id="desktop-news-api-mode"
                        value={mode}
                        onChange={(event) => setMode(event.target.value as DesktopCollectionMode)}
                        disabled={loading || saving}
                        className="mt-2 w-full rounded-xl border border-neutral-500/20 bg-base px-3 py-2.5 text-sm outline-none transition-colors focus:border-cyan-500/60"
                    >
                        <option value="auto">自动：远端优先，网络错误或 5xx 时尝试本地来源</option>
                        <option value="remote">远端：只使用远端 API</option>
                        <option value="local">本地：只使用已安装的本地来源插件</option>
                    </select>
                    <p className="mt-2 text-xs leading-5 op-65">
                        自动模式不会对 401、403、429 或普通客户端错误切换到本地。远端模式需要配置 API
                        地址。本地模式不请求远端新闻 API。
                    </p>

                    {settings && (
                        <div className="mt-3 rounded-xl bg-neutral-500/6 px-3 py-2 text-xs leading-5 op-75">
                            构建默认地址：{settings.defaultUrl}
                        </div>
                    )}

                    {errorMessage && (
                        <div
                            className="mt-3 rounded-xl bg-red-500/8 px-3 py-2 text-sm text-red-700 dark:text-red-300"
                            role="alert"
                        >
                            {errorMessage}
                        </div>
                    )}

                    <div className="mt-5 flex flex-wrap gap-2">
                        <button
                            type="submit"
                            disabled={loading || saving}
                            className="rounded-full bg-cyan-500 px-4 py-2 text-sm font-semibold text-zinc-900 transition-colors hover:bg-cyan-400 disabled:cursor-not-allowed disabled:op-45"
                        >
                            {saving ? "保存中" : "保存并刷新"}
                        </button>
                        <button
                            type="button"
                            disabled={loading || saving}
                            onClick={() => void handleReset()}
                            className="rounded-full bg-neutral-500/10 px-4 py-2 text-sm transition-colors hover:bg-neutral-500/16 disabled:cursor-not-allowed disabled:op-45"
                        >
                            恢复默认
                        </button>
                    </div>
                </form>
            )}

            {trayConfigurable && (
                <div className="settings-group">
                    <label className="flex items-start gap-3 text-sm font-medium" htmlFor="desktop-tray-background">
                        <input
                            id="desktop-tray-background"
                            type="checkbox"
                            checked={trayBackgroundEnabled}
                            disabled={traySaving}
                            onChange={(event) => void handleTrayBackgroundChange(event.target.checked)}
                            className="mt-0.5 accent-cyan-500"
                        />
                        <span>关闭窗口后保留托盘并刷新本地来源</span>
                    </label>
                    <p className="mt-2 pl-6 text-xs leading-5 op-65">
                        启用后，关闭窗口会把 LatestNews
                        收到系统托盘。托盘菜单可以重新打开窗口、立即刷新本地来源或退出应用。远端模式不会运行本地后台刷新。此选项默认关闭。
                    </p>
                    {traySaving && <p className="mt-2 pl-6 text-xs op-65">正在保存…</p>}
                    {trayErrorMessage && (
                        <div
                            className="mt-3 rounded-xl bg-red-500/8 px-3 py-2 text-sm text-red-700 dark:text-red-300"
                            role="alert"
                        >
                            {trayErrorMessage}
                        </div>
                    )}
                </div>
            )}
        </section>
    );
}
