import type { useToast } from "~/hooks/useToast";
import type { PrimitiveMetadata } from "@shared/types";

import { apiFetch } from "~/utils";
import { login, logout } from "~/hooks/useLogin";
import { fixedColumnIds } from "@root/shared/metadata";

const AUTH_SYNC_FEEDBACK_KEY = "auth-sync-feedback";
export type AuthSyncFeedback = "success" | "error";

/** 获取本地 JWT（直接读取字符串，避免将 token 当作 JSON 解析成空字符串） */
export const getJwt = (): string | undefined => {
    const v = localStorage.getItem("access_token");
    return v === null ? undefined : v;
};

/** 统一的身份错误处理 */
export function handleAuthError(toaster: ReturnType<typeof useToast>, error: unknown) {
    if (!(typeof error === "object" && error && "statusCode" in error && error.statusCode === 506)) {
        toaster("身份校验失败，无法同步，请重新登录", {
            type: "error",
            action: { label: "登录", onClick: login },
        });
        logout();
    }
}

export function setAuthSyncFeedback(status: AuthSyncFeedback) {
    sessionStorage.setItem(AUTH_SYNC_FEEDBACK_KEY, status);
}

export function takeAuthSyncFeedback(): AuthSyncFeedback | undefined {
    const status = sessionStorage.getItem(AUTH_SYNC_FEEDBACK_KEY);
    if (status !== "success" && status !== "error") return undefined;

    sessionStorage.removeItem(AUTH_SYNC_FEEDBACK_KEY);
    return status;
}

export function mergePrimitiveMetadata(local: PrimitiveMetadata, remote: PrimitiveMetadata): PrimitiveMetadata {
    const merged: PrimitiveMetadata = {
        updatedTime: Math.max(local.updatedTime, remote.updatedTime),
        data: {
            focus: [],
            hottest: [],
            realtime: [],
        },
        action: local.updatedTime > remote.updatedTime ? "manual" : "sync",
    };

    for (const key of fixedColumnIds) {
        merged.data[key] = Array.from(new Set([...(local.data[key] ?? []), ...(remote.data[key] ?? [])]));
    }

    return merged;
}

export function markPrimitiveMetadataSynced(metadata: PrimitiveMetadata): PrimitiveMetadata {
    return {
        ...metadata,
        action: "sync",
    };
}

export async function downloadMetadata(): Promise<PrimitiveMetadata | undefined> {
    //const jwt = getJwt();
    //if (!jwt) return undefined;

    const res = await apiFetch<{ data: PrimitiveMetadata["data"]; updatedTime: number }>("/api/sync/me", {
        //headers: { Authorization: `Bearer ${jwt}` },
        query: { settingType: "news" },
    });

    if (!res?.data) return undefined;

    return {
        data: res.data,
        updatedTime: res.updatedTime,
        action: "sync",
    };
}

export async function uploadMetadata(metadata: PrimitiveMetadata): Promise<void> {
    //const jwt = getJwt();
    //if (!jwt) return;

    await apiFetch("/api/sync/me", {
        method: "POST",
        //headers: { Authorization: `Bearer ${jwt}` },
        body: { data: metadata.data, settingType: "news" },
    });
}
