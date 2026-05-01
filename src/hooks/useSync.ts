import { useEffect } from "react";
import { useDebounce } from "react-use";
import { useAtom, useSetAtom } from "jotai";
import {
    toErrorStatus,
    toMergedStatus,
    toQueuedStatus,
    toSuccessStatus,
    toSyncingStatus,
    toConflictResolvedStatus,
} from "@shared/metadata-sync-flow";
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
            setSyncStatus((prev) => toSuccessStatus(prev, "auth-feedback"));
            toaster("登录成功，已同步最新布局", { type: "success" });
        } else if (feedback === "error") {
            setSyncStatus((prev) => toErrorStatus(prev, "auth-feedback", "登录后首次同步失败，已继续使用本地布局"));
            toaster("登录成功，但远程布局同步失败，已继续使用本地布局", { type: "warning" });
        }
    }, [setSyncStatus, toaster]);

    useDebounce(
        async () => {
            if (!loggedIn || primitiveMetadata.action !== "manual") return;

            setSyncStatus((prev) => toQueuedStatus(prev, "auto-upload"));
            setSyncStatus((prev) => toSyncingStatus(prev, "auto-upload"));

            try {
                await uploadMetadata(primitiveMetadata);
                setPrimitiveMetadata((prev) => markPrimitiveMetadataSynced(prev));
                setSyncStatus((prev) => toSuccessStatus(prev, "auto-upload"));
            } catch (err: unknown) {
                setSyncStatus((prev) => toErrorStatus(prev, "auto-upload", getSyncErrorMessage(err)));
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
            setSyncStatus((prev) => toSyncingStatus(prev, "login-sync"));

            try {
                const remoteMetadata = await downloadMetadata();
                if (remoteMetadata) {
                    setPrimitiveMetadata((prev) => {
                        const merged = mergePrimitiveMetadata(prev, remoteMetadata);
                        setSyncStatus((current) =>
                            merged.updatedTime === prev.updatedTime
                                ? toConflictResolvedStatus(current, "login-sync")
                                : toMergedStatus(current, "login-sync")
                        );
                        return merged;
                    });
                }
                setSyncStatus((prev) => toSuccessStatus(prev, "login-sync"));
            } catch (err: unknown) {
                setSyncStatus((prev) => toErrorStatus(prev, "login-sync", getSyncErrorMessage(err)));
                handleAuthError(toaster, err);
            }
        };

        void trySync();
    }, [loggedIn, setPrimitiveMetadata, setSyncStatus, toaster]);

    return { uploadMetadata, downloadMetadata };
}
