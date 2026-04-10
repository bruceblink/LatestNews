import { myFetch } from "~/utils";
import { delay } from "@shared/utils.ts";
import { Version, PROJECT_URL } from "@shared/consts";
import { useState, useEffect, useCallback } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";

import { useToast } from "./useToast";

export interface PWAState {
    isOffline: boolean;
    needRefresh: boolean;
    offlineReady: boolean;
    applyUpdate: () => Promise<void>;
}

export function usePWA() {
    const toaster = useToast();
    const {
        updateServiceWorker,
        offlineReady: [offlineReady],
        needRefresh: [needRefresh],
    } = useRegisterSW();
    const [isOffline, setIsOffline] = useState(() => ("onLine" in navigator ? !navigator.onLine : false));

    const applyUpdate = useCallback(async () => {
        await updateServiceWorker();
        localStorage.setItem("updated", "1");
    }, [updateServiceWorker]);

    useEffect(() => {
        const handleOffline = () => {
            setIsOffline(true);
            toaster("网络已断开，当前将优先展示已缓存内容", { type: "warning" });
        };

        const handleOnline = () => {
            setIsOffline(false);
            toaster("网络已恢复，可以继续获取最新资讯", { type: "success" });
        };

        window.addEventListener("offline", handleOffline);
        window.addEventListener("online", handleOnline);

        return () => {
            window.removeEventListener("offline", handleOffline);
            window.removeEventListener("online", handleOnline);
        };
    }, [toaster]);

    useEffect(() => {
        if (!offlineReady) return;

        toaster("离线缓存已就绪，网络波动时仍可继续浏览最近内容", {
            type: "info",
            duration: 4000,
        });
    }, [offlineReady, toaster]);

    useEffect(() => {
        let cancelled = false;

        const showUpdateToast = async () => {
            if (!needRefresh) return;
            if ("onLine" in navigator && !navigator.onLine) return;

            await delay(1000);
            const resp = await myFetch<{ v?: string }>("/latest");
            if (cancelled || !resp.v || resp.v === Version) return;

            toaster("有更新，5 秒后自动更新", {
                action: {
                    label: "立刻更新",
                    onClick: applyUpdate,
                },
                onDismiss: applyUpdate,
            });
        };

        void showUpdateToast();

        return () => {
            cancelled = true;
        };
    }, [applyUpdate, needRefresh, toaster]);

    useEffect(() => {
        void (async () => {
            await delay(1000);
            if (!localStorage.getItem("updated")) return;

            localStorage.removeItem("updated");
            toaster("更新成功，赶快体验吧", {
                action: {
                    label: "查看更新",
                    onClick: () => {
                        window.open(`${PROJECT_URL}/releases/tag/v${Version}`);
                    },
                },
            });
        })();
    }, [toaster]);

    return {
        isOffline,
        needRefresh,
        offlineReady,
        applyUpdate,
    } satisfies PWAState;
}
