import type { SourceID } from "@shared/types";

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
