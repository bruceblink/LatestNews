import { useEffect } from "react";
import { useDebounce } from "react-use";
import { useAtom, useSetAtom } from "jotai";
import {
    uploadMetadata,
    handleAuthError,
    downloadMetadata,
    getSyncErrorMessage,
    takeAuthSyncFeedback,
    mergePrimitiveMetadata,
    markPrimitiveMetadataSynced,
} from "~/services/metadata.service.ts";

import { useToast } from "./useToast";
import { useLoginState } from "./useLogin";
import { metadataSyncStatusAtom } from "../atoms/syncStatusAtom";
import { primitiveMetadataAtom } from "../atoms/primitiveMetadataAtom";

/** Hook: 自动同步 primitiveMetadataAtom */
export function useSync() {
    const [primitiveMetadata, setPrimitiveMetadata] = useAtom(primitiveMetadataAtom);
    const setSyncStatus = useSetAtom(metadataSyncStatusAtom);
    const toaster = useToast();
    const { loggedIn } = useLoginState();

    useEffect(() => {
        const feedback = takeAuthSyncFeedback();
        if (feedback === "success") {
            setSyncStatus({
                phase: "success",
                lastAttemptAt: Date.now(),
                lastSyncedAt: Date.now(),
            });
            toaster("登录成功，已同步最新布局", { type: "success" });
        } else if (feedback === "error") {
            setSyncStatus({
                phase: "error",
                lastAttemptAt: Date.now(),
                lastErrorMessage: "登录后首次同步失败，已继续使用本地布局",
            });
            toaster("登录成功，但远程布局同步失败，已继续使用本地布局", { type: "warning" });
        }
    }, [setSyncStatus, toaster]);

    useDebounce(
        async () => {
            if (!loggedIn || primitiveMetadata.action !== "manual") return;

            setSyncStatus((prev) => ({
                ...prev,
                phase: "queued",
                lastAttemptAt: Date.now(),
                lastErrorMessage: undefined,
            }));

            setSyncStatus((prev) => ({
                ...prev,
                phase: "syncing",
                lastAttemptAt: Date.now(),
                lastErrorMessage: undefined,
            }));

            try {
                await uploadMetadata(primitiveMetadata);
                setPrimitiveMetadata((prev) => markPrimitiveMetadataSynced(prev));
                setSyncStatus((prev) => ({
                    ...prev,
                    phase: "success",
                    lastAttemptAt: Date.now(),
                    lastSyncedAt: Date.now(),
                    lastErrorMessage: undefined,
                }));
            } catch (err: unknown) {
                setSyncStatus((prev) => ({
                    ...prev,
                    phase: "error",
                    lastAttemptAt: Date.now(),
                    lastErrorMessage: getSyncErrorMessage(err),
                }));
                handleAuthError(toaster, err);
            }
        },
        5000,
        [primitiveMetadata, loggedIn, setPrimitiveMetadata, setSyncStatus, toaster]
    );

    /** 登录状态变化时自动同步配置 */
    useEffect(() => {
        if (!loggedIn) return;

        const trySync = async () => {
            setSyncStatus((prev) => ({
                ...prev,
                phase: "syncing",
                lastAttemptAt: Date.now(),
                lastErrorMessage: undefined,
            }));

            try {
                const remoteMetadata = await downloadMetadata();
                if (remoteMetadata) {
                    setPrimitiveMetadata((prev) => {
                        const merged = mergePrimitiveMetadata(prev, remoteMetadata);
                        setSyncStatus((current) => ({
                            ...current,
                            phase: merged.updatedTime === prev.updatedTime ? "conflict-resolved" : "merged",
                        }));
                        return merged;
                    });
                }
                setSyncStatus((prev) => ({
                    ...prev,
                    phase: "success",
                    lastAttemptAt: Date.now(),
                    lastSyncedAt: Date.now(),
                    lastErrorMessage: undefined,
                }));
            } catch (err: unknown) {
                setSyncStatus((prev) => ({
                    ...prev,
                    phase: "error",
                    lastAttemptAt: Date.now(),
                    lastErrorMessage: getSyncErrorMessage(err),
                }));
                handleAuthError(toaster, err);
            }
        };

        void trySync();
    }, [loggedIn, setPrimitiveMetadata, setSyncStatus, toaster]);

    return { uploadMetadata, downloadMetadata };
}
