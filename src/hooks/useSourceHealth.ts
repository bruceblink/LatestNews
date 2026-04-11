import type { SourceID } from "@shared/types";

import { useMemo } from "react";
import { myFetch } from "~/utils";
import { useQuery } from "@tanstack/react-query";

export type SourceHealthStatus = "idle" | "healthy" | "failing";

export interface SourceHealthEvent {
    status: Exclude<SourceHealthStatus, "idle">;
    occurredAt: number;
    durationMs: number;
    itemCount?: number;
    errorMessage?: string;
}

export interface SourceHealthSnapshot {
    id: SourceID;
    name: string;
    status: SourceHealthStatus;
    successCount: number;
    errorCount: number;
    consecutiveFailures: number;
    lastDurationMs?: number;
    lastSuccessAt?: number;
    lastErrorAt?: number;
    lastErrorMessage?: string;
    lastItemCount?: number;
    recentEvents: SourceHealthEvent[];
}

export interface SourceHealthSummary {
    updatedAt: number;
    total: number;
    healthy: number;
    failing: number;
    idle: number;
    sources: SourceHealthSnapshot[];
}

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
