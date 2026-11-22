import { useEffect } from "react";
import { useDebounce } from "react-use";
import { useSetAtom, useAtomValue } from "jotai";
import { syncMetadataAtom } from "~/atoms/syncMetadataAtom";
import { primitiveMetadataAtom } from "~/atoms/primitiveMetadataAtom";
import { handleAuthError, getSyncErrorMessage, authLayoutCallbackKey } from "~/services/metadata.service";

import { useToast } from "./useToast";
import { useLoginState } from "./useLogin";

export function useSync() {
    const metadata = useAtomValue(primitiveMetadataAtom);
    const syncMetadata = useSetAtom(syncMetadataAtom);
    const toaster = useToast();
    const { loggedIn, userInfo } = useLoginState();

    useDebounce(
        () => {
            if (!loggedIn || metadata.action !== "manual") return;

            void syncMetadata("auto-upload").catch((error: unknown) => {
                if (!handleAuthError(toaster, error)) toaster(getSyncErrorMessage(error), { type: "error" });
            });
        },
        5000,
        [metadata, loggedIn, userInfo, syncMetadata, toaster]
    );

    useEffect(() => {
        if (!loggedIn || !userInfo) return;

        const fromCallback = sessionStorage.getItem(authLayoutCallbackKey) === "true";
        if (fromCallback) sessionStorage.removeItem(authLayoutCallbackKey);
        void syncMetadata("login-sync")
            .then((result) => {
                if (!fromCallback || result === "skipped") return;
                const message = result === "pending" ? "登录成功，已保留本地布局" : "登录成功，布局同步完成";
                toaster(message, { type: "success" });
            })
            .catch((error: unknown) => {
                if (!handleAuthError(toaster, error)) {
                    toaster("云端布局同步失败，已继续使用本地布局", { type: "warning" });
                }
            });
    }, [loggedIn, userInfo, syncMetadata, toaster]);
}
