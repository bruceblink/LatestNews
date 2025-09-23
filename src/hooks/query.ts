import type { SourceID, SourceResponse } from "@shared/types";

import { useQuery, useQueryClient } from "@tanstack/react-query";

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

export function useEntireQuery(items: SourceID[]) {
    const update = useUpdateQuery();
    useQuery({
        // sort in place
        queryKey: ["entire", [...items].sort()],
        queryFn: async ({ queryKey }) => {
            const sources = queryKey[1];
            if (sources.length === 0) return null;
            const res: SourceResponse[] | undefined = await myFetch("/s/entire", {
                method: "POST",
                body: {
                    sources,
                },
            });
            if (res?.length) {
                const s = [] as SourceID[];
                res.forEach((v) => {
                    const id = v.id;
                    if (!cacheSources.has(id) || cacheSources.get(id)!.updatedTime < v.updatedTime) {
                        s.push(id);
                        cacheSources.set(id, v);
                    }
                });
                // update now
                update(...s);

                return res;
            }
            return null;
        },
        staleTime: 1000 * 60 * 3,
        retry: false,
    });
}
