import { myFetch } from "~/utils";
import { atomWithStorage } from "jotai/utils";
import { useAtomValue, getDefaultStore } from "jotai";

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

export const logout = () => {
    // 更新 atom
    const store = getDefaultStore();
    store.set(userAtom, null);
    // 清除本地存储
    localStorage.removeItem("access_token");
    localStorage.removeItem("metadata");
    localStorage.removeItem("user");
    // 刷新页面
    window.location.href = "/";
};

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
