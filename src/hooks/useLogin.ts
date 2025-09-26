import { myFetch } from "~/utils";
import { jwtDecode } from "jwt-decode";
import { atomWithStorage } from "jotai/utils";
import { useEffect, useCallback } from "react";
import { useSetAtom, useAtomValue } from "jotai";

// -----------------------------
// Atoms
// -----------------------------
export const userAtom = atomWithStorage<{ name?: string; avatar?: string }>("user", {});
export const jwtAtom = atomWithStorage("access_token", "");
export const enableLoginAtom = atomWithStorage<{ enable: boolean; url?: string }>("login", { enable: true });

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
    const userInfo = useAtomValue(userAtom);
    const jwt = useAtomValue(jwtAtom);
    const enableLogin = useAtomValue(enableLoginAtom);
    const setUser = useSetAtom(userAtom);

    // 🔑 监听 jwt 自动解码 user
    useEffect(() => {
        if (jwt) {
            try {
                const payload = jwtDecode<{ name?: string; avatar?: string }>(jwt);
                setUser({ name: payload.name, avatar: payload.avatar });
            } catch (err) {
                console.error("JWT 解码失败", err);
                setUser({});
            }
        } else {
            setUser({});
        }
    }, [jwt, setUser]);

    const login = useCallback(() => {
        window.location.href = `${import.meta.env.VITE_API_URL}/auth/github/login?redirect_uri=${encodeURIComponent(
            `${window.location.origin}/auth/callback`
        )}`;
    }, []);

    const logout = useCallback(() => {
        window.localStorage.clear();
        window.location.reload();
    }, []);

    return {
        loggedIn: !!jwt,
        userInfo,
        enableLogin: enableLogin.enable,
        logout,
        login,
    };
}
