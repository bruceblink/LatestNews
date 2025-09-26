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

        if (token) {
            // ✅ 只存 jwt，解码交给 useLogin 统一做
            setJwt(token);
            localStorage.setItem("access_token", token);
            // 跳转首页的关注，替换历史记录
            navigate({ to: "/", replace: true });
        } else {
            toaster("登录失败：缺少 token", { type: "error" });
        }
    }, [setJwt, navigate, toaster]);

    return null;
}
