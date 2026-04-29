import { myFetch } from "~/utils";
import { delay } from "@shared/utils.ts";
import { Version, PROJECT_URL } from "@shared/consts";
import { useRegisterSW } from "virtual:pwa-register/react";
import { useRef, useState, useEffect, useCallback } from "react";

import { useToast } from "./useToast";

export interface PWAState {
    isOffline: boolean;
    needRefresh: boolean;
    offlineReady: boolean;
    justRecovered: boolean;
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
    const [justRecovered, setJustRecovered] = useState(false);
    const recoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const applyUpdate = useCallback(async () => {
        await updateServiceWorker();
        localStorage.setItem("updated", "1");
    }, [updateServiceWorker]);

    useEffect(() => {
        const handleOffline = () => {
            setIsOffline(true);
            setJustRecovered(false);
            if (recoverTimerRef.current) {
                clearTimeout(recoverTimerRef.current);
                recoverTimerRef.current = null;
            }
            toaster("网络已断开，当前将优先展示已缓存内容", { type: "warning" });
        };

        const handleOnline = () => {
            setIsOffline(false);
            setJustRecovered(true);
            if (recoverTimerRef.current) clearTimeout(recoverTimerRef.current);
            recoverTimerRef.current = setTimeout(() => setJustRecovered(false), 8000);
            toaster("网络已恢复，可以继续获取最新资讯", { type: "success" });
        };

        window.addEventListener("offline", handleOffline);
        window.addEventListener("online", handleOnline);

        return () => {
            window.removeEventListener("offline", handleOffline);
            window.removeEventListener("online", handleOnline);
            if (recoverTimerRef.current) clearTimeout(recoverTimerRef.current);
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
        justRecovered,
        applyUpdate,
    } satisfies PWAState;
}
