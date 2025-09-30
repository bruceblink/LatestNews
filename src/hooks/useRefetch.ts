import type { SourceID } from "@shared/types";

import { useCallback } from "react";
import { useToast } from "~/hooks/useToast.ts";
import { refetchSources } from "~/utils/data.ts";

import { useUpdateQuery } from "./query";
import { login, useLoginState } from "./useLogin";

export function useRefetch() {
    const toaster = useToast();
    const { enableLogin, loggedIn } = useLoginState();
    const updateQuery = useUpdateQuery();
    /**
     * force refresh
     */
    const refresh = useCallback(
        (...sources: SourceID[]) => {
            if (enableLogin && !loggedIn) {
                toaster("登录后可以手动刷新数据", {
                    type: "warning",
                    action: {
                        label: "登录",
                        onClick: login,
                    },
                });
            } else {
                refetchSources.clear();
                sources.forEach((id) => refetchSources.add(id));
                updateQuery(...sources);
            }
        },
        [loggedIn, toaster, enableLogin, updateQuery]
    );

    return {
        refresh,
        refetchSources,
    };
}
