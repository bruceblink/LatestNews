import { useEffect } from "react";
import { useLocation } from "react-use";
import { useToast } from "~/hooks/useToast.ts";
import { useNavigate, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/auth/callback")({
    component: CallbackPage,
});

function CallbackPage() {
    const toaster = useToast();
    const location = useLocation();
    const navigate = useNavigate();

    useEffect(() => {
        const params = new URLSearchParams(location.search);
        const token = params.get("token");

        if (token) {
            // 存储 access_token
            localStorage.setItem("access_token", token);

            // 去首页，替换历史记录，避免 token 残留在地址栏
            navigate({ to: "/", replace: true });
        }
    }, [location, navigate]);

    toaster("登录成功", {
        type: "success",
    });
    return null;
}
