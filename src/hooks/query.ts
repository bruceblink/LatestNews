import type { SourceID, SourceResponse } from "@shared/types";

import { useCallback } from "react";
import { cacheSources } from "~/utils/data.ts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { normalizeEntireSourcesResponse } from "@shared/source-api";
import { fetchEntireSourcesEnvelope } from "~/services/source.service";
import { getSourceCacheKey, getEntireSourcesCacheKey } from "@shared/source-api";

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
    const queryClient = useQueryClient();
    useQuery({
        // sort in place
        queryKey: getEntireSourcesCacheKey(items),
        queryFn: async ({ queryKey }) => {
            const sources = queryKey[1];
            if (sources.length === 0) return null;
            const response = await fetchEntireSourcesEnvelope(sources);
            const res: SourceResponse[] | undefined = normalizeEntireSourcesResponse(response);
            if (!Array.isArray(response) && response.errors.length) {
                console.warn("Some sources failed to resolve", response.errors);
            }
            if (res?.length) {
                res.forEach((v) => {
                    const id = v.id;
                    if (!cacheSources.has(id) || cacheSources.get(id)!.updatedTime < v.updatedTime) {
                        cacheSources.set(id, v);
                        queryClient.setQueryData(getSourceCacheKey(id), v);
                    }
                });

                return res;
            }
            return null;
        },
        staleTime: 1000 * 60 * 3,
        retry: false,
    });
}
