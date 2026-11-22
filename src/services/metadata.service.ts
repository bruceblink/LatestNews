import type { useToast } from "~/hooks/useToast";
import type { PrimitiveMetadata } from "@shared/types";

import { apiFetch } from "~/utils";
import { login, logout } from "~/hooks/useLogin";
import { verifyPrimitiveMetadata } from "@shared/verify";
import { isAuthenticationError } from "@shared/auth-error";

export const authLayoutCallbackKey = "latestnews:auth-layout-callback";
const layoutPath = "/api/sync/me";

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

export async function downloadMetadata(): Promise<PrimitiveMetadata | undefined> {
    const res = await apiFetch<{ data: PrimitiveMetadata["data"]; updatedTime: number }>(layoutPath, {
        headers: createAuthHeaders(),
        query: { settingType: "news" },
    });

    if (res?.data == null) return undefined;
    verifyPrimitiveMetadata(res);

    return {
        data: res.data,
        updatedTime: res.updatedTime,
        action: "sync",
    };
}

export async function uploadMetadata(metadata: PrimitiveMetadata): Promise<void> {
    await apiFetch(layoutPath, {
        method: "POST",
        headers: createAuthHeaders(),
        body: { data: metadata.data, settingType: "news" },
    });
}
