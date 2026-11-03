import { delay } from "@shared/utils.ts";
import { Version, PROJECT_URL } from "@shared/consts";
import { useRegisterSW } from "virtual:pwa-register/react";
import { useRef, useState, useEffect, useContext, useCallback, createContext } from "react";

import { useToast } from "./useToast";

export interface PWAState {
    isOffline: boolean;
    needRefresh: boolean;
    offlineReady: boolean;
    justRecovered: boolean;
    applyUpdate: () => Promise<void>;
}

export const PWAStatusContext = createContext<Pick<PWAState, "isOffline">>({ isOffline: false });

/** Gives route components the root PWA connectivity state without registering a second service worker. */
export function usePWAStatus() {
    return useContext(PWAStatusContext);
}

export function usePWA() {
    const toaster = useToast();
    const registrationRef = useRef<ServiceWorkerRegistration>();
    const [activatedUpdate, setActivatedUpdate] = useState(false);
    const {
        offlineReady: [offlineReady],
        needRefresh: [needRefresh],
    } = useRegisterSW({
        onRegisteredSW: (_url, registration) => {
            registrationRef.current = registration;
            if (registration && navigator.onLine) {
                void registration.update().catch((error: unknown) => console.warn("[pwa] Update check failed.", error));
            }
        },
        onNeedReload: () => setActivatedUpdate(true),
        onRegisterError: (error: unknown) => console.warn("[pwa] Service worker registration failed.", error),
    });
    const [isOffline, setIsOffline] = useState(() => ("onLine" in navigator ? !navigator.onLine : false));
    const [justRecovered, setJustRecovered] = useState(false);
    const recoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const applyUpdate = useCallback(async () => {
        try {
            localStorage.setItem("updated", "1");
        } catch {
            // Updating must still work when browser storage is blocked.
        }
        const waiting = registrationRef.current?.waiting;
        if (!waiting) {
            window.location.reload();
            return;
        }
        navigator.serviceWorker.addEventListener("controllerchange", () => window.location.reload(), { once: true });
        waiting.postMessage({ type: "SKIP_WAITING" });
    }, []);

    useEffect(() => {
        const check = () => {
            if (document.visibilityState === "visible" && navigator.onLine) {
                void registrationRef.current
                    ?.update()
                    .catch((error: unknown) => console.warn("[pwa] Update check failed.", error));
            }
        };
        const interval = window.setInterval(check, 60 * 60 * 1000);
        window.addEventListener("online", check);
        document.addEventListener("visibilitychange", check);
        return () => {
            clearInterval(interval);
            window.removeEventListener("online", check);
            document.removeEventListener("visibilitychange", check);
        };
    }, []);

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
        void (async () => {
            await delay(1000);
            if (!hasUpdateMarker()) return;

            try {
                localStorage.removeItem("updated");
            } catch {
                // A blocked storage area must not prevent the app from starting after an update.
            }
            toaster("更新成功，赶快体验吧", {
                action: {
                    label: "查看更新",
                    onClick: () => {
                        window.open(`${PROJECT_URL}/releases/tag/v${Version}`, "_blank", "noopener,noreferrer");
                    },
                },
            });
        })();
    }, [toaster]);

    return {
        isOffline,
        needRefresh: needRefresh || activatedUpdate,
        offlineReady,
        justRecovered,
        applyUpdate,
    } satisfies PWAState;
}

function hasUpdateMarker() {
    try {
        return localStorage.getItem("updated") === "1";
    } catch {
        return false;
    }
}
