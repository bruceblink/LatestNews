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
                if (metadata) {
                    // 使用 setter 的 updater 函数确保写入时的 updatedTime 大于当前值
                    setPrimitiveMetadata((prev) => {
                        const serverMeta = preprocessMetadata(metadata);
                        // 归一化：如果服务器返回的时间看起来是秒级（较小），或不大于当前，使用 Date.now()
                        let normalized = serverMeta.updatedTime ?? Date.now();
                        // 如果服务器时间明显小于当前（例如以秒为单位），补偿为毫秒
                        if (normalized < 1e12) {
                            // 可能为秒，转换为毫秒
                            normalized = normalized * 1000;
                        }
                        // 确保 strictly greater than prev.updatedTime to pass atom's comparison
                        if (normalized <= prev.updatedTime) normalized = Date.now();

                        return {
                            ...serverMeta,
                            updatedTime: normalized,
                            action: "sync",
                        };
                    });
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
    }, [setJwt, setPrimitiveMetadata, navigate, toaster, downloadMetadata]);

    return null;
}
