import type { SourceID } from "@shared/types";

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";

export function useUpdateQuery() {
    const queryClient = useQueryClient();

    /**
     * update query
     */
    return useCallback(
        async (...sources: SourceID[]) => {
            await queryClient.refetchQueries({
                predicate: (query) => {
                    const [type, id] = query.queryKey as ["source" | "entire", SourceID];
                    return type === "source" && sources.includes(id);
                },
            });
        },
        [queryClient]
    );
}
