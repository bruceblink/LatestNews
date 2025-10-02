import type { PrimitiveMetadata } from "@shared/types";

import { useAtom } from "jotai";
import { useEffect } from "react";
import { useDebounce } from "react-use";
import { apiFetch, safeParseString } from "~/utils";
import { preprocessMetadata, primitiveMetadataAtom } from "~/atoms/primitiveMetadataAtom.ts";

import { useToast } from "./useToast";
import { login, logout, useLoginState } from "./useLogin";

/** 获取本地 JWT */
function getJwt(): string | undefined {
    return safeParseString(localStorage.getItem("access_token"));
}

/** 上传 metadata 到服务器 */
async function uploadMetadataToServer(metadata: PrimitiveMetadata): Promise<void> {
    const jwt = getJwt();
    if (!jwt) return;

    await apiFetch("/api/sync/me", {
        method: "POST",
        headers: { Authorization: `Bearer ${jwt}` },
        body: { data: metadata.data, setting_type: "news" },
    });
}

/** 下载 metadata 从服务器 */
async function downloadMetadataFromServer(): Promise<PrimitiveMetadata | undefined> {
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
}

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

/**
 * Hook: 自动同步 primitiveMetadataAtom
 * - 登录后自动拉取服务器数据初始化
 * - primitiveMetadata.action === 'manual' 时自动上传（防抖）
 * - 监听登录状态变化，自动下载 metadata
 */
export function useSync() {
    const [primitiveMetadata, setPrimitiveMetadata] = useAtom(primitiveMetadataAtom);
    const toaster = useToast();
    const { loggedIn } = useLoginState();

    /** 上传到服务器（防抖调用） */
    const tryUpload = async () => {
        if (!loggedIn) return;
        try {
            if (primitiveMetadata.action === "manual") {
                await uploadMetadataToServer(primitiveMetadata);
            }
        } catch (err: any) {
            handleAuthError(toaster, err);
        }
    };

    // 防抖上传：metadata.action === manual 时才上传
    useDebounce(tryUpload, 10000, [primitiveMetadata, loggedIn]);

    // 登录状态变化时自动下载
    useEffect(() => {
        /** 下载并更新 atom */
        const tryDownload = async () => {
            if (!loggedIn) return;

            try {
                const metadata = await downloadMetadataFromServer();
                if (metadata) setPrimitiveMetadata(preprocessMetadata(metadata));
            } catch (err: any) {
                handleAuthError(toaster, err);
            }
        };

        tryDownload();
    }, [loggedIn, setPrimitiveMetadata, toaster]);
}
