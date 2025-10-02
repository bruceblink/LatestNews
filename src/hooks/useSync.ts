import type { PrimitiveMetadata } from "@shared/types";

import { useAtom } from "jotai";
import { useEffect } from "react";
import { useDebounce } from "react-use";
import { apiFetch, safeParseString } from "~/utils";
import { preprocessMetadata, primitiveMetadataAtom } from "~/atoms/primitiveMetadataAtom.ts";

import { useToast } from "./useToast";
import { login, logout, useLoginState } from "./useLogin";

/** 获取本地 JWT */
const getJwt = (): string | undefined => safeParseString(localStorage.getItem("access_token"));

/** 上传 metadata 到服务器 */
const uploadMetadataToServer = async (metadata: PrimitiveMetadata): Promise<void> => {
    const jwt = getJwt();
    if (!jwt) return;

    await apiFetch("/api/sync/me", {
        method: "POST",
        headers: { Authorization: `Bearer ${jwt}` },
        body: { data: metadata.data, setting_type: "news" },
    });
};

/** 下载 metadata 从服务器 */
const downloadMetadataFromServer = async (): Promise<PrimitiveMetadata | undefined> => {
    const jwt = getJwt();
    if (!jwt) return undefined;

    const res = await apiFetch<{ data: PrimitiveMetadata["data"]; updatedTime: number }>("/api/sync/me", {
        headers: { Authorization: `Bearer ${jwt}` },
        query: { setting_type: "news" },
    });

    if (res?.data) return { data: res.data, updatedTime: res.updatedTime, action: "sync" };
    return undefined;
};

/** 统一身份验证错误处理 */
const handleAuthError = (toaster: ReturnType<typeof useToast>, error: any) => {
    if (error?.statusCode !== 506) {
        toaster("身份校验失败，无法同步，请重新登录", {
            type: "error",
            action: { label: "登录", onClick: login },
        });
        logout();
    }
};

/** 合并服务器 metadata 与本地 metadata，保留本地未上传修改 */
const mergeMetadata = (local: PrimitiveMetadata, server: PrimitiveMetadata): PrimitiveMetadata => {
    const mergedData: PrimitiveMetadata["data"] = { ...local.data };

    for (const columnId of Object.keys(server.data)) {
        const localSources = local.data[columnId as keyof typeof local.data] ?? [];
        const serverSources = server.data[columnId as keyof typeof server.data] ?? [];

        // 保留本地 source，合并服务器新增
        mergedData[columnId as keyof typeof mergedData] = Array.from(new Set([...localSources, ...serverSources]));
    }

    return {
        ...local,
        data: mergedData,
        action: "sync",
        updatedTime: Math.max(local.updatedTime, server.updatedTime),
    };
};

/**
 * Hook: 自动同步 primitiveMetadataAtom
 */
export function useSync() {
    const [primitiveMetadata, setPrimitiveMetadata] = useAtom(primitiveMetadataAtom);
    const toaster = useToast();
    const { loggedIn } = useLoginState();

    /** 上传：primitiveMetadata.action === 'manual' */
    const tryUpload = async () => {
        if (!loggedIn) return;
        if (primitiveMetadata.action !== "manual") return;

        try {
            await uploadMetadataToServer(primitiveMetadata);
        } catch (err: any) {
            handleAuthError(toaster, err);
        }
    };

    // 防抖上传
    useDebounce(tryUpload, 10000, [primitiveMetadata, loggedIn]);

    /** 登录后立即同步：上传本地修改 + 下载服务器最新并合并 */
    useEffect(() => {
        if (!loggedIn) return;

        const syncOnce = async () => {
            try {
                // 先上传本地修改（manual 状态）
                if (primitiveMetadata.action === "manual") {
                    await uploadMetadataToServer(primitiveMetadata);
                }

                // 下载服务器 metadata
                const serverMetadata = await downloadMetadataFromServer();
                if (serverMetadata) {
                    const merged = mergeMetadata(primitiveMetadata, serverMetadata);
                    setPrimitiveMetadata(preprocessMetadata(merged));
                }
            } catch (err: any) {
                handleAuthError(toaster, err);
            }
        };

        syncOnce();
    }, [loggedIn, primitiveMetadata, setPrimitiveMetadata, toaster]);
}
