import type { PrimitiveMetadata } from "@shared/types";

import { useAtom } from "jotai";
import { useMount, useDebounce } from "react-use";
import { apiFetch, safeParseString } from "~/utils";
import { preprocessMetadata, primitiveMetadataAtom } from "~/atoms/primitiveMetadataAtom.ts";

import { useToast } from "./useToast";
import { login, logout } from "./useLogin";

async function uploadMetadata(metadata: PrimitiveMetadata) {
    const jwt = safeParseString(localStorage.getItem("access_token"));
    if (!jwt) return;
    await apiFetch("/api/sync/me", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${jwt}`,
        },
        body: {
            data: metadata.data,
            setting_type: "news",
        },
    });
}

async function downloadMetadata(): Promise<PrimitiveMetadata | undefined> {
    const jwt = safeParseString(localStorage.getItem("access_token"));
    if (!jwt) return undefined;
    const { data, status } = await apiFetch<PrimitiveMetadata>("/api/sync/me", {
        headers: {
            Authorization: `Bearer ${jwt}`,
        },
        query: {
            setting_type: "news",
        },
    });
    // 不用同步 action 字段
    if (data && status === "ok") {
        return {
            status,
            data,
            action: "sync",
        };
    }
    return undefined;
}

export function useSync() {
    const [primitiveMetadata, setPrimitiveMetadata] = useAtom(primitiveMetadataAtom);
    const toaster = useToast();

    useDebounce(
        async () => {
            const fn = async () => {
                try {
                    await uploadMetadata(primitiveMetadata);
                } catch (e: any) {
                    if (e.statusCode !== 506) {
                        toaster("身份校验失败，无法同步，请重新登录", {
                            type: "error",
                            action: {
                                label: "登录",
                                onClick: login,
                            },
                        });
                        logout();
                    }
                }
            };

            if (primitiveMetadata.action === "manual") {
                await fn();
            }
        },
        10000,
        [primitiveMetadata]
    );
    useMount(() => {
        const fn = async () => {
            try {
                const metadata = await downloadMetadata();
                if (metadata) {
                    setPrimitiveMetadata(preprocessMetadata(metadata));
                }
            } catch (e: any) {
                if (e.statusCode !== 506) {
                    toaster("身份校验失败，无法同步，请重新登录", {
                        type: "error",
                        action: {
                            label: "登录",
                            onClick: login,
                        },
                    });
                    logout();
                }
            }
        };
        void fn();
    });
}
