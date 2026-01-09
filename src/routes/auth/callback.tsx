import { useEffect } from "react";
import { useSetAtom } from "jotai";
import { useToast } from "~/hooks/useToast.ts";
import { login, logout } from "~/hooks/useLogin";
import { useSync, mergePrimitiveMetadata } from "~/hooks/useSync";
import { useNavigate, createFileRoute } from "@tanstack/react-router";
import { primitiveMetadataAtom } from "~/atoms/primitiveMetadataAtom";

export const Route = createFileRoute("/auth/callback")({
    component: CallbackPage,
});

function CallbackPage() {
    const toaster = useToast();
    const navigate = useNavigate();
    const setPrimitiveMetadata = useSetAtom(primitiveMetadataAtom);
    const { downloadMetadata } = useSync(); // 复用 hook 提供的函数

    useEffect(() => {
        (async () => {
            try {
                const metadata = await downloadMetadata();
                if (metadata) {
                    setPrimitiveMetadata((prev) => mergePrimitiveMetadata(prev, metadata));
                }

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
    }, [setPrimitiveMetadata, navigate, toaster, downloadMetadata]);

    return null;
}
