import type { DesktopUpdateState } from "@shared/desktop-updates";

import { useState, useEffect } from "react";

/** Subscriptions exist only while settings are open; the main process owns background checks. */
export function DesktopUpdates() {
    const bridge = window.latestNewsDesktop?.updates;
    const [state, setState] = useState<DesktopUpdateState>();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    useEffect(() => {
        if (!bridge) return undefined;
        let active = true;
        let receivedEvent = false;
        const unsubscribe = bridge.onState((next) => {
            receivedEvent = true;
            setState(next);
        });
        void bridge.getState().then(
            (next) => {
                if (active && !receivedEvent) setState(next);
            },
            () => {
                if (active) setError("无法读取更新状态，请重新打开设置。");
            }
        );
        return () => {
            active = false;
            unsubscribe();
        };
    }, [bridge]);

    if (!bridge) return null;
    const working = busy || ["checking", "downloading", "installing"].includes(state?.status ?? "");
    const act = async (action: () => Promise<DesktopUpdateState>) => {
        setBusy(true);
        setError("");
        try {
            setState(await action());
        } catch {
            setError("无法执行更新操作，请重试。");
        } finally {
            setBusy(false);
        }
    };
    const statuses = {
        disabled: "开发运行或当前包不支持更新，请使用正式安装包。",
        idle: "尚未检查",
        checking: "正在检查更新",
        "not-available": "已是最新版本",
        available: "发现新版本",
        downloading: "正在下载更新",
        downloaded: "更新已下载。保存工作后可退出安装。",
        installing: "正在启动安装",
        error: "更新失败，请检查网络后重试。",
    };
    const buttonClass = "rounded-full bg-neutral-500/10 px-4 py-2 text-sm disabled:op-45";
    return (
        <section
            id="desktop-update-settings"
            className="settings-group"
            data-test-id="desktop-updates"
            aria-label="应用更新"
        >
            <h2 className="text-lg font-semibold">应用更新</h2>
            {state && (
                <>
                    <p className="mt-3 text-sm">当前版本：{state.currentVersion}</p>
                    {state.availableVersion && <p className="mt-2 text-sm">可用版本：{state.availableVersion}</p>}
                    <label className="mt-4 flex items-center gap-3 text-sm">
                        <input
                            type="checkbox"
                            checked={state.autoCheck}
                            disabled={busy}
                            onChange={(event) => {
                                const enabled = event.target.checked;
                                setState((current) => (current ? { ...current, autoCheck: enabled } : current));
                                void act(() => bridge.setAutoCheck(enabled));
                            }}
                        />
                        自动检查更新
                    </label>
                    <p className="mt-3 text-sm" role="status">
                        {statuses[state.status]}
                    </p>
                    {state.progress && (
                        <div className="mt-3">
                            <progress
                                className="w-full"
                                aria-label="下载进度"
                                max={100}
                                value={state.progress.percent}
                            />
                            <p className="text-xs">{Math.round(state.progress.percent)}%</p>
                        </div>
                    )}
                    {state.error === "settings-failed" && <p role="alert">无法保存或读取更新设置。</p>}
                    <div className="mt-4 flex flex-wrap gap-2">
                        <button
                            className={buttonClass}
                            disabled={working || ["disabled", "downloaded"].includes(state.status)}
                            onClick={() => void act(() => bridge.check())}
                        >
                            检查更新
                        </button>
                        {state.availableVersion &&
                            ["available", "error"].includes(state.status) &&
                            state.error !== "install-failed" && (
                                <button
                                    className={buttonClass}
                                    disabled={working}
                                    onClick={() => void act(() => bridge.download())}
                                >
                                    下载更新
                                </button>
                            )}
                        {state.status === "downloading" && (
                            <button className={buttonClass} onClick={() => void bridge.cancel()}>
                                取消下载
                            </button>
                        )}
                        {(state.status === "downloaded" || state.error === "install-failed") && (
                            <button
                                className={buttonClass}
                                disabled={working}
                                onClick={() => void act(() => bridge.install())}
                            >
                                退出并安装
                            </button>
                        )}
                    </div>
                </>
            )}
            {error && (
                <p className="mt-3 text-sm text-red-600" role="alert">
                    {error}
                </p>
            )}
        </section>
    );
}
