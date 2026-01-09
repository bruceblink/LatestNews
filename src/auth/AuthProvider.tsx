import { useSetAtom } from "jotai";
import React, { useEffect } from "react";

import { initAuthAtom } from "./authAtoms";

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const initAuth = useSetAtom(initAuthAtom);

    useEffect(() => {
        initAuth(); // 🔥 应用启动时只跑一次
    }, [initAuth]);

    return <>{children}</>;
}
