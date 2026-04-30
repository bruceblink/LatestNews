import type { SourceHealthSummary } from "@shared/source-health-types";

import { useMemo } from "react";
import { myFetch } from "~/utils";
import { useQuery } from "@tanstack/react-query";

export function useSourceHealthSummary() {
    const query = useQuery<SourceHealthSummary>({
        queryKey: ["source-health"],
        queryFn: () => myFetch("/s/health"),
        staleTime: 1000 * 30,
        retry: false,
    });

    const sourceHealthMap = useMemo(
        () => new Map((query.data?.sources ?? []).map((source) => [source.id, source])),
        [query.data?.sources]
    );

    return {
        ...query,
        sourceHealthMap,
    };
}
