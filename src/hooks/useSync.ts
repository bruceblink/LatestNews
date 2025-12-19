import type { PrimitiveMetadata } from "@shared/types";

import { useAtom } from "jotai";
import { apiFetch } from "~/utils";
import { useDebounce } from "react-use";
import { useEffect, useCallback } from "react";
import { fixedColumnIds } from "@shared/metadata";
import { primitiveMetadataAtom } from "~/atoms/primitiveMetadataAtom.ts";

import { useToast } from "./useToast";
import { login, logout, useLoginState } from "./useLogin";

/** 获取本地 JWT（直接读取字符串，避免将 token 当作 JSON 解析成空字符串） */
const getJwt = (): string | undefined => {
    const v = localStorage.getItem("access_token");
    return v === null ? undefined : v;
};

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

export function mergePrimitiveMetadata(local: PrimitiveMetadata, remote: PrimitiveMetadata): PrimitiveMetadata {
    const merged: PrimitiveMetadata = {
        updatedTime: Math.max(local.updatedTime, remote.updatedTime),
        data: {
            focus: [],
            hottest: [],
            realtime: [],
        },
        // ⭐ 关键：merge 本身就是一次本地写
        action: "manual",
    };

    for (const key of fixedColumnIds) {
        merged.data[key] = Array.from(new Set([...(local.data[key] ?? []), ...(remote.data[key] ?? [])]));
    }

    return merged;
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
            body: { data: metadata.data, settingType: "news" },
        });
    }, []);

    /** 下载 metadata 从服务器 */
    const downloadMetadata = useCallback(async (): Promise<PrimitiveMetadata | undefined> => {
        const jwt = getJwt();
        if (!jwt) return undefined;

        const res = await apiFetch<{ data: PrimitiveMetadata["data"]; updatedTime: number }>("/api/sync/me", {
            headers: { Authorization: `Bearer ${jwt}` },
            query: { settingType: "news" },
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
        5000,
        [primitiveMetadata, loggedIn, uploadMetadata, toaster]
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
    }, [loggedIn, setPrimitiveMetadata, toaster, downloadMetadata]);

    return { uploadMetadata, downloadMetadata };
}
