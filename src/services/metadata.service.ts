import type { useToast } from "~/hooks/useToast";
import type { PrimitiveMetadata } from "@shared/types";

import { apiFetch } from "~/utils";
import { login, logout } from "~/hooks/useLogin";
import { isAuthenticationError } from "@shared/auth-error";
import { mergePrimitiveMetadata } from "@shared/metadata-merge";

const AUTH_SYNC_FEEDBACK_KEY = "auth-sync-feedback";
export type AuthSyncFeedback = "success" | "error";

/** 获取本地 JWT（直接读取字符串，避免将 token 当作 JSON 解析成空字符串） */
export const getJwt = (): string | undefined => {
    const v = localStorage.getItem("access_token");
    return v === null ? undefined : v;
};

export function createAuthHeaders(): Record<string, string> | undefined {
    const jwt = getJwt();
    return jwt ? { Authorization: `Bearer ${jwt}` } : undefined;
}

/** 统一的身份错误处理 */
export function handleAuthError(toaster: ReturnType<typeof useToast>, error: unknown) {
    if (!isAuthenticationError(error)) return false;

    toaster("身份校验失败，无法同步，请重新登录", {
        type: "error",
        action: { label: "登录", onClick: login },
    });
    void logout();
    return true;
}

export function getSyncErrorMessage(error: unknown) {
    if (error instanceof Error && error.message) {
        return error.message;
    }

    if (typeof error === "string" && error.trim()) {
        return error;
    }

    return "同步请求失败，请稍后重试";
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

export { mergePrimitiveMetadata };

export function markPrimitiveMetadataSynced(metadata: PrimitiveMetadata): PrimitiveMetadata {
    return {
        ...metadata,
        action: "sync",
    };
}

export async function downloadMetadata(): Promise<PrimitiveMetadata | undefined> {
    const res = await apiFetch<{ data: PrimitiveMetadata["data"]; updatedTime: number }>("/api/sync/me", {
        headers: createAuthHeaders(),
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
    await apiFetch("/api/sync/me", {
        method: "POST",
        headers: createAuthHeaders(),
        body: { data: metadata.data, settingType: "news" },
    });
}
