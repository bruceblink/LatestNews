import type { SourceID } from "@shared/types";

export type SourceHealthStatus = "idle" | "healthy" | "failing";

export interface SourceHealthEvent {
    status: Exclude<SourceHealthStatus, "idle">;
    occurredAt: number;
    durationMs: number;
    itemCount?: number;
    errorMessage?: string;
}

/** Cumulative source-quality counters for the current service sampling window. */
export interface SourceHealthQuality {
    rawItemCount: number;
    validItemCount: number;
    invalidItemCount: number;
    duplicateItemCount: number;
    publishedItemCount: number;
    emptyResultCount: number;
    firstSampleAt?: number;
    lastEmptyReason?: string;
    lastNewestPublishedAt?: number;
    lastFreshnessMs?: number;
}

export interface SourceHealthSnapshot {
    id: SourceID;
    name: string;
    status: SourceHealthStatus;
    successCount: number;
    errorCount: number;
    consecutiveFailures: number;
    cacheDegraded: boolean;
    lastDurationMs?: number;
    lastSuccessAt?: number;
    lastErrorAt?: number;
    lastErrorMessage?: string;
    lastItemCount?: number;
    quality?: SourceHealthQuality;
    recentEvents: SourceHealthEvent[];
}

export interface SourceHealthSummary {
    updatedAt: number;
    total: number;
    healthy: number;
    failing: number;
    idle: number;
    cacheDegraded: number;
    sampleWindowStartedAt?: number;
    sources: SourceHealthSnapshot[];
}
