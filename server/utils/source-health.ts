import type { SourceID } from "@shared/types";

import dataSources from "@shared/data-sources";

export type ServerSourceHealthStatus = "idle" | "healthy" | "failing";

export interface ServerSourceHealthEvent {
    status: Exclude<ServerSourceHealthStatus, "idle">;
    occurredAt: number;
    durationMs: number;
    itemCount?: number;
    errorMessage?: string;
}

export interface ServerSourceHealthSnapshot {
    id: SourceID;
    name: string;
    status: ServerSourceHealthStatus;
    successCount: number;
    errorCount: number;
    consecutiveFailures: number;
    lastDurationMs?: number;
    lastSuccessAt?: number;
    lastErrorAt?: number;
    lastErrorMessage?: string;
    lastItemCount?: number;
    recentEvents: ServerSourceHealthEvent[];
}

type MutableSourceHealthSnapshot = ServerSourceHealthSnapshot;

const sourceHealthMap = new Map<SourceID, MutableSourceHealthSnapshot>();

function getSourceMeta(id: SourceID) {
    return dataSources[id];
}

function createIdleSnapshot(id: SourceID): ServerSourceHealthSnapshot {
    return {
        id,
        name: getSourceMeta(id).name,
        status: "idle",
        successCount: 0,
        errorCount: 0,
        consecutiveFailures: 0,
        recentEvents: [],
    };
}

function pushRecentEvent(snapshot: MutableSourceHealthSnapshot, event: ServerSourceHealthEvent) {
    snapshot.recentEvents = [event, ...snapshot.recentEvents].slice(0, 5);
}

function getOrCreateSnapshot(id: SourceID): MutableSourceHealthSnapshot {
    const existing = sourceHealthMap.get(id);
    if (existing) return existing;

    const snapshot: MutableSourceHealthSnapshot = createIdleSnapshot(id);

    sourceHealthMap.set(id, snapshot);
    return snapshot;
}

export function recordSourceSuccess(id: SourceID, durationMs: number, itemCount: number) {
    const snapshot = getOrCreateSnapshot(id);
    snapshot.status = "healthy";
    snapshot.successCount += 1;
    snapshot.consecutiveFailures = 0;
    snapshot.lastDurationMs = durationMs;
    snapshot.lastSuccessAt = Date.now();
    snapshot.lastItemCount = itemCount;
    snapshot.lastErrorMessage = undefined;
    pushRecentEvent(snapshot, {
        status: "healthy",
        occurredAt: snapshot.lastSuccessAt,
        durationMs,
        itemCount,
    });
}

export function recordSourceFailure(id: SourceID, durationMs: number, error: unknown) {
    const snapshot = getOrCreateSnapshot(id);
    const errorMessage = error instanceof Error ? error.message : String(error);
    snapshot.status = "failing";
    snapshot.errorCount += 1;
    snapshot.consecutiveFailures += 1;
    snapshot.lastDurationMs = durationMs;
    snapshot.lastErrorAt = Date.now();
    snapshot.lastErrorMessage = errorMessage;
    pushRecentEvent(snapshot, {
        status: "failing",
        occurredAt: snapshot.lastErrorAt,
        durationMs,
        errorMessage,
    });
}

export function getSourceHealthSnapshot(id: SourceID): ServerSourceHealthSnapshot {
    return sourceHealthMap.get(id) ?? createIdleSnapshot(id);
}

export function getSourceHealthSnapshots(): ServerSourceHealthSnapshot[] {
    return Object.entries(dataSources)
        .filter(([_, source]) => !source.redirect)
        .map(([id]) => {
            const sourceId = id as SourceID;
            return getSourceHealthSnapshot(sourceId);
        })
        .sort((left, right) => {
            if (left.status !== right.status) {
                const weight = {
                    failing: 0,
                    idle: 1,
                    healthy: 2,
                } satisfies Record<ServerSourceHealthStatus, number>;
                return weight[left.status] - weight[right.status];
            }

            return left.name.localeCompare(right.name, "zh-CN");
        });
}

export function getSourceHealthSummary() {
    const sources = getSourceHealthSnapshots();
    return {
        updatedAt: Date.now(),
        total: sources.length,
        healthy: sources.filter((source) => source.status === "healthy").length,
        failing: sources.filter((source) => source.status === "failing").length,
        idle: sources.filter((source) => source.status === "idle").length,
        sources,
    };
}
