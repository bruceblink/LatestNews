import type { DesktopUpdateState } from "@shared/desktop-updates";

import { useState, useEffect } from "react";
import { Link } from "@tanstack/react-router";

/** Keep the desktop update available while the user navigates outside settings. */
export function DesktopUpdateNotice() {
    const bridge = window.latestNewsDesktop?.updates;
    const [state, setState] = useState<DesktopUpdateState>();
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        if (!bridge) return undefined;
        let active = true;
        let received = false;
        const unsubscribe = bridge.onState((next) => {
            received = true;
            setState(next);
        });
        void bridge.getState().then(
            (next) => {
                if (active && !received) setState(next);
            },
            () => {
                if (active) setFailed(true);
            }
        );
        return () => {
            active = false;
            unsubscribe();
        };
    }, [bridge]);

    if (
        !bridge ||
        !state?.availableVersion ||
        !["available", "downloading", "downloaded", "installing", "error"].includes(state.status)
    ) {
        return null;
    }

    const act = async (action: () => Promise<DesktopUpdateState>) => {
        setFailed(false);
        try {
            setState(await action());
        } catch {
            setFailed(true);
        }
    };
    const text = {
        available: `发现新版本 ${state.availableVersion}。`,
        downloading: `正在下载 ${state.availableVersion}（${Math.round(state.progress?.percent ?? 0)}%）。`,
        downloaded: `${state.availableVersion} 已下载。保存工作后可安装。`,
        installing: "正在启动安装。",
        error: "更新失败，请重试或打开设置。",
    }[state.status as "available" | "downloading" | "downloaded" | "installing" | "error"];

    return (
        <section className="update-notice" role="status" data-test-id="desktop-update-notice">
            <div>
                <strong>{text}</strong>
                {failed && <span className="update-notice-error">操作失败，请重试。</span>}
            </div>
            <div className="update-notice-actions">
                {state.status === "downloading" ? (
                    <button type="button" onClick={() => void act(() => bridge.cancel())}>
                        取消下载
                    </button>
                ) : state.status === "downloaded" || state.error === "install-failed" ? (
                    <button type="button" onClick={() => void act(() => bridge.install())}>
                        退出并安装
                    </button>
                ) : state.status === "available" || state.status === "error" ? (
                    <button type="button" onClick={() => void act(() => bridge.download())}>
                        下载更新
                    </button>
                ) : null}
                <Link to="/settings" hash="desktop-update-settings">
                    更新设置
                </Link>
            </div>
        </section>
    );
}
