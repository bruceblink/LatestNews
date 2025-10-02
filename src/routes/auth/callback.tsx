import { useEffect } from "react";
import { useSetAtom } from "jotai";
import { useSync } from "~/hooks/useSync";
import { useToast } from "~/hooks/useToast.ts";
import { login, logout, jwtAtom } from "~/hooks/useLogin";
import { useNavigate, createFileRoute } from "@tanstack/react-router";
import { preprocessMetadata, primitiveMetadataAtom } from "~/atoms/primitiveMetadataAtom";

export const Route = createFileRoute("/auth/callback")({
    component: CallbackPage,
});

function CallbackPage() {
    const toaster = useToast();
    const navigate = useNavigate();
    const setJwt = useSetAtom(jwtAtom);
    const setPrimitiveMetadata = useSetAtom(primitiveMetadataAtom);
    const { downloadMetadata } = useSync(); // 复用 hook 提供的函数

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const token = params.get("token");

        if (!token) {
            toaster("登录失败：缺少 token", { type: "error" });
            return;
        }

        (async () => {
            try {
                setJwt(token);
                localStorage.setItem("access_token", token);

                const metadata = await downloadMetadata();
                if (metadata) setPrimitiveMetadata(preprocessMetadata(metadata));

                await navigate({ to: "/", replace: true });
            } catch (err: any) {
                console.error("同步 metadata 失败:", err);
                toaster("身份校验失败，无法同步，请重新登录", {
                    type: "error",
                    action: { label: "登录", onClick: login },
                });
                logout();
            }
        })();
    }, [setJwt, setPrimitiveMetadata, navigate, toaster, downloadMetadata]);

    return null;
}
