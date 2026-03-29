import { myFetch } from "~/utils";
import { useEffect } from "react";
import { delay } from "@shared/utils.ts";
import { Version, PROJECT_URL } from "@shared/consts";
import { useRegisterSW } from "virtual:pwa-register/react";

import { useToast } from "./useToast";

export function usePWA() {
    const toaster = useToast();
    const {
        updateServiceWorker,
        needRefresh: [needRefresh],
    } = useRegisterSW();

    useEffect(() => {
        let cancelled = false;
        const update = () => {
            updateServiceWorker().then(() => localStorage.setItem("updated", "1"));
        };

        const showUpdateToast = async () => {
            if (!needRefresh) return;
            if ("onLine" in navigator && !navigator.onLine) return;

            await delay(1000);
            const resp = await myFetch<{ v?: string }>("/latest");
            if (cancelled || !resp.v || resp.v === Version) return;

            toaster("有更新，5 秒后自动更新", {
                action: {
                    label: "立刻更新",
                    onClick: update,
                },
                onDismiss: update,
            });
        };

        void showUpdateToast();

        return () => {
            cancelled = true;
        };
    }, [needRefresh, toaster, updateServiceWorker]);

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
}
