import { jwtDecode } from "jwt-decode";
import { myFetch, apiFetch } from "~/utils";
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

        const refreshWindow = 60 * 1000; // 剩余 1 分钟刷新
        let timer: NodeJS.Timeout;

        const scheduleCheck = () => {
            const now = Date.now();
            const expireTime = payload.exp! * 1000;
            const timeLeft = expireTime - now;

            if (timeLeft <= 0) {
                logout();
                return;
            }

            if (timeLeft <= refreshWindow) {
                apiFetch("/auth/refresh", {
                    method: "POST",
                    credentials: "include", // ✅ 自动发送 refresh token cookie
                })
                    .then(
                        (res: {
                            status: string;
                            data: {
                                access_token: string;
                                access_token_exp: number;
                                user: { name: string; avatar_url: string };
                            };
                        }) => {
                            if (res.status === "ok" && res.data.access_token) {
                                setJwt(res.data.access_token);
                                setUser({
                                    name: res.data.user.name,
                                    avatar: res.data.user.avatar_url,
                                });
                            } else {
                                logout();
                            }
                        }
                    )
                    .catch(() => {
                        logout();
                    });
            }
            // 至少剩余30秒会刷新
            const nextCheck = Math.max(30 * 1000, timeLeft / 2);
            timer = setTimeout(scheduleCheck, nextCheck);
        };

        scheduleCheck();

        // eslint-disable-next-line consistent-return
        return () => clearTimeout(timer);
    }, [payload?.exp, logout, setJwt, setUser]);

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
