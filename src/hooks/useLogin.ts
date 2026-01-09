import { myFetch, apiFetch } from "~/utils";
import { atomWithStorage } from "jotai/utils";
import { useAtomValue, getDefaultStore } from "jotai";

import { queryClient } from "../main";
import { userAtom, authStatusAtom } from "../auth/authAtoms";

// -----------------------------
// 全局状态
// -----------------------------
export const enableLoginAtom = atomWithStorage<{ enable: boolean; url?: string }>("login", { enable: true });

// 初始化登录开关
enableLoginAtom.onMount = (set) => {
    myFetch("/enable-login")
        .then((r) => set(r))
        .catch((e) => {
            if (e.statusCode === 506) {
                set({ enable: false });
                localStorage.removeItem("access_token");
            }
        });
};

// -----------------------------
// 登录/登出函数（全局独立）
// -----------------------------
export const login = () => {
    window.location.href = `${import.meta.env.VITE_API_URL}/auth/oauth/github/login?redirect_uri=${encodeURIComponent(
        `${window.location.origin}/auth/callback`
    )}`;
};

export async function logout() {
    const store = getDefaultStore();

    try {
        // 1️⃣ 通知后端（必须等待）
        await apiFetch("/logout", {
            method: "POST",
            credentials: "include",
        });
    } catch (e) {
        // 即使失败，也继续本地登出
        console.warn("logout api failed", e);
    }

    // 2️⃣ 清空 auth 状态（关键）
    store.set(userAtom, null);
    store.set(authStatusAtom, "unauthenticated");

    // 3️⃣ 清空所有登录态相关缓存
    queryClient.clear();

    // 4️⃣ 路由级跳转（而不是刷新页面）
    window.location.replace("/");
}

// -----------------------------
// Hook 获取登录状态（任意组件可用）
// -----------------------------
export function useLoginState() {
    const authStatus = useAtomValue(authStatusAtom);
    const userInfo = useAtomValue(userAtom);
    const enableLogin = useAtomValue(enableLoginAtom);
    return {
        loading: authStatus === "idle" || authStatus === "loading",
        loggedIn: authStatus === "authenticated",
        userInfo,
        enableLogin,
    };
}
