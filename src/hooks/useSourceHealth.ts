import type { SourceHealthSummary } from "@shared/source-health-types";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { sourceHealthCacheKey } from "@shared/source-api";
import { fetchSourceHealthSummary } from "~/services/source.service";

export function useSourceHealthSummary() {
    const query = useQuery<SourceHealthSummary>({
        queryKey: sourceHealthCacheKey,
        queryFn: fetchSourceHealthSummary,
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
