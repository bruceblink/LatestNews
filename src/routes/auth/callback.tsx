import { useEffect } from "react";
import { useSetAtom } from "jotai";
import { jwtAtom } from "~/hooks/useLogin";
import { useToast } from "~/hooks/useToast.ts";
import { useNavigate, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/auth/callback")({
    component: CallbackPage,
});

function CallbackPage() {
    const toaster = useToast();
    const navigate = useNavigate();
    const setJwt = useSetAtom(jwtAtom);

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const token = params.get("token");

        if (!token) {
            toaster("登录失败：缺少 token", { type: "error" });
            return;
        }

        // 1️⃣ 保存 JWT 到 atom
        setJwt(token);

        // 2️⃣ 保存到 localStorage，供页面刷新后读取
        localStorage.setItem("access_token", token);

        // 3️⃣ useSync 会自动拉取服务器 metadata 并合并到 primitiveMetadataAtom
        //这一步其实已经由 useSync hook 完成
        // 4️⃣ 登录完成后导航回首页（关注页）
        navigate({ to: "/", replace: true });
    }, [setJwt, navigate, toaster]);

    return null;
}
