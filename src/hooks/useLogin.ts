import { myFetch } from "~/utils";
import { jwtDecode } from "jwt-decode";
import { atomWithStorage } from "jotai/utils";
import { atom, useSetAtom, useAtomValue } from "jotai";
import { useMemo, useEffect, useCallback } from "react";

// -----------------------------
// Atoms
// -----------------------------
export const userAtom = atomWithStorage<{ name?: string; avatar?: string }>("user", {});
export const jwtAtom = atom<string | null>(typeof window !== "undefined" ? localStorage.getItem("access_token") : null);
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
// Hook
// -----------------------------
export function useLogin() {
    const jwt = useAtomValue(jwtAtom);
    const setJwt = useSetAtom(jwtAtom);
    const setUser = useSetAtom(userAtom);
    const enableLogin = useAtomValue(enableLoginAtom);

    // 登出
    const logout = useCallback(() => {
        localStorage.removeItem("access_token");
        localStorage.removeItem("user");
        setJwt(null); // ✅ 清空 jwtAtom
        setUser({}); // ✅ 清空 userAtom
    }, [setJwt, setUser]);

    // 解码 JWT
    const payload = useMemo(() => {
        if (!jwt) return null;
        try {
            return jwtDecode<{ name?: string; avatar?: string; exp?: number }>(jwt);
        } catch {
            return null;
        }
    }, [jwt]);

    // 初始化 user 状态
    useEffect(() => {
        if (!payload || !payload.exp) {
            setUser({});
            return;
        }

        if (Date.now() >= payload.exp * 1000) {
            logout();
        } else {
            setUser({ name: payload.name, avatar: payload.avatar });
        }
    }, [payload, logout, setUser]);

    // 判断是否登录
    const loggedIn = useMemo(() => !!payload?.exp && Date.now() < payload.exp * 1000, [payload]);

    // 心跳检查 token 是否过期
    useEffect(() => {
        if (!payload?.exp) return;
        const timer = setInterval(() => {
            if (Date.now() >= payload.exp! * 1000) {
                logout();
            }
        }, 60 * 1000);
        // eslint-disable-next-line consistent-return
        return () => clearInterval(timer);
    }, [payload?.exp, logout]);

    // 登录跳转
    const login = useCallback(() => {
        window.location.href = `${import.meta.env.VITE_API_URL}/auth/github/login?redirect_uri=${encodeURIComponent(
            `${window.location.origin}/auth/callback`
        )}`;
    }, []);

    return {
        loggedIn,
        userInfo: useAtomValue(userAtom),
        enableLogin: enableLogin.enable,
        login,
        logout,
    };
}
