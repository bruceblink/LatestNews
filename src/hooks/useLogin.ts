import { myFetch } from "~/utils";
import { useCallback } from "react";
import { useAtomValue } from "jotai";
import { atomWithStorage } from "jotai/utils";

const userAtom = atomWithStorage<{
    name?: string;
    avatar?: string;
}>("user", {});

const jwtAtom = atomWithStorage("access_token", "");

const enableLoginAtom = atomWithStorage<{
    enable: boolean;
    url?: string;
}>("login", {
    enable: true,
});

enableLoginAtom.onMount = (set) => {
    myFetch("/enable-login")
        .then((r) => {
            set(r);
        })
        .catch((e) => {
            if (e.statusCode === 506) {
                set({ enable: false });
                localStorage.removeItem("access_token");
            }
        });
};

export function useLogin() {
    const userInfo = useAtomValue(userAtom);
    const jwt = useAtomValue(jwtAtom);
    const enableLogin = useAtomValue(enableLoginAtom);

    const login = useCallback(() => {
        window.location.href = `${import.meta.env.VITE_API_URL}/auth/github/login?redirect_uri=${encodeURIComponent(`${window.location.origin}/auth/callback`)}`;
    }, [enableLogin]);

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
