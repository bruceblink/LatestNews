import { jwtDecode } from "jwt-decode";
import { useMemo, useEffect } from "react";
import { myFetch, apiFetch } from "~/utils";
import { atomWithStorage } from "jotai/utils";
import { useSetAtom, useAtomValue, getDefaultStore } from "jotai";

// -----------------------------
// 全局状态
// -----------------------------
export const jwtAtom = atomWithStorage<string | null>(
    "access_token",
    typeof window !== "undefined" ? localStorage.getItem("access_token") : null
);
export const userAtom = atomWithStorage<{ name?: string; avatar?: string }>("user", {});
export const enableLoginAtom = atomWithStorage<{ enable: boolean; url?: string }>("login", { enable: true });

// 初始化登录开关
enableLoginAtom.onMount = (set) => {
    myFetch("/enable-login")
        .then((r) => set(r))
        .catch((e) => {
            if (e.statusCode === 506) {
                set({ enable: false });
                const store = getDefaultStore();
                store.set(jwtAtom, null);
                localStorage.removeItem("access_token");
            }
        });
};

// -----------------------------
// 登录/登出函数（全局独立）
// -----------------------------
export const login = () => {
    window.location.href = `${import.meta.env.VITE_API_URL}/auth/github/login?redirect_uri=${encodeURIComponent(
        `${window.location.origin}/auth/callback`
    )}`;
};

export const logout = () => {
    // 更新 atom
    const store = getDefaultStore();
    store.set(jwtAtom, null);
    store.set(userAtom, {});
    // 清除本地存储
    localStorage.removeItem("access_token");
    localStorage.removeItem("metadata");
    localStorage.removeItem("user");
    // 刷新页面
    window.location.href = "/";
};

// -----------------------------
// Hook：全局状态初始化 + 自动刷新 token
// -----------------------------
export function useLoginManager() {
    const jwt = useAtomValue(jwtAtom);
    const setJwt = useSetAtom(jwtAtom);
    const setUser = useSetAtom(userAtom);

    // 初始化用户信息
    useEffect(() => {
        if (!jwt) {
            setUser({});
            return;
        }

        let payload: { name?: string; avatar?: string; exp?: number } | null = null;
        try {
            payload = jwtDecode(jwt);
        } catch {
            payload = null;
        }

        if (!payload || !payload.exp) {
            setUser({});
            setJwt(null);
            return;
        }

        if (Date.now() >= payload.exp * 1000) {
            logout();
            return;
        }

        setUser({ name: payload.name, avatar: payload.avatar });

        // 自动刷新 token：到期前 1 分钟
        const refreshWindow = 60 * 1000; // 1 分钟
        let refreshing = false;
        let timer: ReturnType<typeof setTimeout>;

        const scheduleRefresh = () => {
            const timeLeft = payload!.exp! * 1000 - Date.now() - refreshWindow;
            if (timeLeft <= 0) {
                refreshToken();
            } else {
                timer = setTimeout(refreshToken, timeLeft);
            }
        };

        const refreshToken = async () => {
            if (refreshing) return;
            refreshing = true;
            try {
                const res = await apiFetch("/auth/refresh", { method: "POST", credentials: "include" });
                if (res.status === "ok") {
                    setJwt(res.data.access_token);
                    setUser({ name: res.data.user.name, avatar: res.data.user.avatar_url });
                    payload = jwtDecode(res.data.access_token); // 更新 payload
                    scheduleRefresh(); // 重新计算下一次刷新
                } else {
                    logout();
                }
            } catch {
                logout();
            } finally {
                refreshing = false;
            }
        };

        scheduleRefresh();

        // eslint-disable-next-line consistent-return
        return () => clearTimeout(timer);
    }, [jwt, setJwt, setUser]);
}

// -----------------------------
// Hook 获取登录状态（任意组件可用）
// -----------------------------
export function useLoginState() {
    const jwt = useAtomValue(jwtAtom);
    const enableLogin = useAtomValue(enableLoginAtom);
    const userInfo = useAtomValue(userAtom);

    const loggedIn = useMemo(() => {
        if (!jwt) return false;
        try {
            const payload = jwtDecode<{ exp?: number }>(jwt);
            return !!payload?.exp && Date.now() < payload.exp * 1000;
        } catch {
            return false;
        }
    }, [jwt]);

    return { enableLogin, loggedIn, userInfo };
}
