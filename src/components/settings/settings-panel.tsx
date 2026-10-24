import type { FormEvent } from "react";

import { useState, useEffect } from "react";
import { useToast } from "~/hooks/useToast";
import {
    saveDesktopNewsApiUrl,
    resetDesktopNewsApiUrl,
    readDesktopNewsApiSettings,
    type DesktopNewsApiSettings,
    isDesktopNewsApiConfigurable,
} from "~/services/desktop-settings.service";

interface SettingsPanelProps {
    showTitle?: boolean;
}

/** Shared settings surface used by the standalone header button and the settings route. */
export function SettingsPanel({ showTitle = true }: SettingsPanelProps) {
    const toaster = useToast();
    const desktopBuild = import.meta.env.LATESTNEWS_DESKTOP === true;
    const configurable = desktopBuild && isDesktopNewsApiConfigurable();
    const [settings, setSettings] = useState<DesktopNewsApiSettings>();
    const [url, setUrl] = useState("");
    const [loading, setLoading] = useState(configurable);
    const [saving, setSaving] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string>();

    useEffect(() => {
        let cancelled = false;
        if (configurable) {
            void readDesktopNewsApiSettings()
                .then((next) => {
                    if (cancelled) return;
                    setSettings(next);
                    setUrl(next.url);
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

    const handleSave = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setSaving(true);
        setErrorMessage(undefined);
        try {
            await saveDesktopNewsApiUrl(url);
            toaster("数据源 API 地址已保存，页面即将刷新", { type: "success" });
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

    return (
        <section className="space-y-5">
            {showTitle && (
                <div>
                    <h1 className="m-0 text-2xl font-semibold text-zinc-800 dark:text-zinc-100">设置</h1>
                    <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                        Web 和桌面端使用同一套配置面板。登录服务和 SyncHub 地址不受数据源地址影响。
                    </p>
                </div>
            )}

            {!desktopBuild && (
                <div className="rounded-2xl bg-neutral-500/8 p-5 text-sm leading-6 text-zinc-700 dark:text-zinc-300">
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
                    className="rounded-2xl bg-base/70 p-5 shadow shadow-primary/8 backdrop-blur-sm"
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
                        disabled={loading || saving}
                        className="mt-2 w-full rounded-xl border border-neutral-500/20 bg-base px-3 py-2.5 text-sm outline-none transition-colors focus:border-cyan-500/60"
                    />
                    <p className="mt-2 text-xs leading-5 op-65">
                        只填写服务根地址，例如 <code>https://news.example.com</code>。应用会自动请求该地址下的{" "}
                        <code>/api</code> 路径。生产构建要求 HTTPS；本地开发允许 localhost HTTP。
                    </p>

                    {settings && (
                        <div className="mt-3 rounded-xl bg-neutral-500/6 px-3 py-2 text-xs leading-5 op-75">
                            构建默认地址：{settings.defaultUrl}
                        </div>
                    )}

                    {errorMessage && (
                        <div className="mt-3 rounded-xl bg-red-500/8 px-3 py-2 text-sm text-red-700 dark:text-red-300">
                            {errorMessage}
                        </div>
                    )}

                    <div className="mt-5 flex flex-wrap gap-2">
                        <button
                            type="submit"
                            disabled={loading || saving || !url.trim()}
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
        </section>
    );
}
