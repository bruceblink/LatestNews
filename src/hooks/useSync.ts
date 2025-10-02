import type { PrimitiveMetadata } from "@shared/types";

import { useAtom } from "jotai";
import { useDebounce } from "react-use";
import { useEffect, useCallback } from "react";
import { apiFetch, safeParseString } from "~/utils";
import { preprocessMetadata, primitiveMetadataAtom } from "~/atoms/primitiveMetadataAtom.ts";

import { useToast } from "./useToast";
import { login, logout, useLoginState } from "./useLogin";

/** 获取本地 JWT */
const getJwt = (): string | undefined => safeParseString(localStorage.getItem("access_token"));

/** 统一的身份错误处理 */
function handleAuthError(toaster: ReturnType<typeof useToast>, error: any) {
    if (error?.statusCode !== 506) {
        toaster("身份校验失败，无法同步，请重新登录", {
            type: "error",
            action: { label: "登录", onClick: login },
        });
        logout();
    }
}

/** Hook: 自动同步 primitiveMetadataAtom */
export function useSync() {
    const [primitiveMetadata, setPrimitiveMetadata] = useAtom(primitiveMetadataAtom);
    const toaster = useToast();
    const { loggedIn } = useLoginState();

    /** 上传 metadata 到服务器 */
    const uploadMetadata = useCallback(async (metadata: PrimitiveMetadata) => {
        const jwt = getJwt();
        if (!jwt) return;

        await apiFetch("/api/sync/me", {
            method: "POST",
            headers: { Authorization: `Bearer ${jwt}` },
            body: { data: metadata.data, setting_type: "news" },
        });
    }, []);

    /** 下载 metadata 从服务器 */
    const downloadMetadata = useCallback(async (): Promise<PrimitiveMetadata | undefined> => {
        const jwt = getJwt();
        if (!jwt) return undefined;

        const res = await apiFetch<{ data: PrimitiveMetadata["data"]; updatedTime: number }>("/api/sync/me", {
            headers: { Authorization: `Bearer ${jwt}` },
            query: { setting_type: "news" },
        });

        if (res?.data) {
            return { data: res.data, updatedTime: res.updatedTime, action: "sync" };
        }
        return undefined;
    }, []);

    /** 防抖自动上传 */
    useDebounce(
        async () => {
            if (!loggedIn || primitiveMetadata.action !== "manual") return;
            try {
                await uploadMetadata(primitiveMetadata);
            } catch (err: any) {
                handleAuthError(toaster, err);
            }
        },
        10000,
        [primitiveMetadata, loggedIn, uploadMetadata, toaster]
    );

    /** 登录状态变化时自动下载 */
    useEffect(() => {
        if (!loggedIn) return;

        const tryDownload = async () => {
            try {
                const metadata = await downloadMetadata();
                if (metadata) setPrimitiveMetadata(preprocessMetadata(metadata));
            } catch (err: any) {
                handleAuthError(toaster, err);
            }
        };

        tryDownload();
    }, [loggedIn, setPrimitiveMetadata, toaster, downloadMetadata]);

    return { uploadMetadata, downloadMetadata };
}
