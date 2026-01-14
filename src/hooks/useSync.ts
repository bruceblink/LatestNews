import { useAtom } from "jotai";
import { useEffect } from "react";
import { useDebounce } from "react-use";
import {
    uploadMetadata,
    handleAuthError,
    downloadMetadata,
    mergePrimitiveMetadata,
} from "~/services/metadata.service.ts";

import { useToast } from "./useToast";
import { useLoginState } from "./useLogin";
import { primitiveMetadataAtom } from "../atoms/primitiveMetadataAtom";

/** Hook: 自动同步 primitiveMetadataAtom */
export function useSync() {
    const [primitiveMetadata, setPrimitiveMetadata] = useAtom(primitiveMetadataAtom);
    const toaster = useToast();
    const { loggedIn } = useLoginState();

    useDebounce(
        async () => {
            if (!loggedIn || primitiveMetadata.action !== "manual") return;
            try {
                await uploadMetadata(primitiveMetadata);
            } catch (err: any) {
                handleAuthError(toaster, err);
            }
        },
        5000,
        [primitiveMetadata, loggedIn, toaster]
    );

    /** 登录状态变化时自动同步配置 */
    useEffect(() => {
        if (!loggedIn) return;

        const trySync = async () => {
            try {
                const remoteMetadata = await downloadMetadata();
                if (remoteMetadata) {
                    setPrimitiveMetadata((prev) => mergePrimitiveMetadata(prev, remoteMetadata));
                }
            } catch (err: any) {
                handleAuthError(toaster, err);
            }
        };

        trySync();
    }, [loggedIn, setPrimitiveMetadata, toaster]);

    return { uploadMetadata, downloadMetadata };
}
