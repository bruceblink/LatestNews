import type { SourceID } from "@shared/types";
import type { SourceHealthQuality } from "@shared/source-health-types";
import type { NewsItemsNormalizationQuality } from "@shared/news-item-schema";

import { logger } from "#/utils/logger";
import dataSources from "@shared/data-sources";
import { shouldDegradeSourceToCache } from "@shared/source-health-policy";
import { getSourceHealthEventsTable } from "#/database/source-health-events";

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
    cacheDegraded: boolean;
    lastDurationMs?: number;
    lastSuccessAt?: number;
    lastErrorAt?: number;
    lastErrorMessage?: string;
    lastItemCount?: number;
    quality: SourceHealthQuality;
    recentEvents: ServerSourceHealthEvent[];
}

type MutableSourceHealthSnapshot = ServerSourceHealthSnapshot;

const sourceHealthMap = new Map<SourceID, MutableSourceHealthSnapshot>();
const RECENT_EVENT_LIMIT = 20;

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
        cacheDegraded: false,
        quality: createEmptyQuality(),
        recentEvents: [],
    };
}

function pushRecentEvent(snapshot: MutableSourceHealthSnapshot, event: ServerSourceHealthEvent) {
    snapshot.recentEvents = [event, ...snapshot.recentEvents].slice(0, RECENT_EVENT_LIMIT);
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
    const occurredAt = Date.now();
    snapshot.status = "healthy";
    snapshot.successCount += 1;
    snapshot.consecutiveFailures = 0;
    snapshot.cacheDegraded = false;
    snapshot.lastDurationMs = durationMs;
    snapshot.lastSuccessAt = occurredAt;
    snapshot.lastItemCount = itemCount;
    snapshot.lastErrorMessage = undefined;
    snapshot.quality.firstSampleAt ??= occurredAt;
    pushRecentEvent(snapshot, {
        status: "healthy",
        occurredAt,
        durationMs,
        itemCount,
    });
    persistSourceHealthEvent(id, snapshot.recentEvents[0]);
}

/** Add item-level quality counters after a successful source normalization pass. */
export function recordSourceQuality(id: SourceID, quality: NewsItemsNormalizationQuality, sampledAt: number) {
    const snapshot = getOrCreateSnapshot(id);
    const counters = snapshot.quality;
    counters.firstSampleAt ??= sampledAt;
    counters.rawItemCount += quality.rawItemCount;
    counters.validItemCount += quality.validItemCount;
    counters.invalidItemCount += quality.invalidItemCount;
    counters.duplicateItemCount += quality.duplicateItemCount;
    counters.publishedItemCount += quality.publishedItemCount;

    if (quality.validItemCount === 0) {
        counters.emptyResultCount += 1;
        counters.lastEmptyReason = quality.rawItemCount === 0 ? "源返回空列表" : "条目校验后为空";
    } else {
        counters.lastEmptyReason = undefined;
    }

    counters.lastNewestPublishedAt = quality.newestPublishedAt;
    counters.lastFreshnessMs =
        quality.newestPublishedAt === undefined ? undefined : Math.max(0, sampledAt - quality.newestPublishedAt);
}

export function recordSourceFailure(id: SourceID, durationMs: number, error: unknown) {
    const snapshot = getOrCreateSnapshot(id);
    const occurredAt = Date.now();
    const errorMessage = error instanceof Error ? error.message : String(error);
    snapshot.status = "failing";
    snapshot.errorCount += 1;
    snapshot.consecutiveFailures += 1;
    snapshot.cacheDegraded = shouldDegradeSourceToCache(snapshot);
    snapshot.lastDurationMs = durationMs;
    snapshot.lastErrorAt = occurredAt;
    snapshot.lastErrorMessage = errorMessage;
    snapshot.quality.firstSampleAt ??= occurredAt;
    pushRecentEvent(snapshot, {
        status: "failing",
        occurredAt,
        durationMs,
        errorMessage,
    });
    persistSourceHealthEvent(id, snapshot.recentEvents[0]);
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
    const sampleWindowStartedAt = sources
        .map((source) => source.quality.firstSampleAt)
        .filter((time): time is number => time !== undefined)
        .sort((left, right) => left - right)[0];
    return {
        updatedAt: Date.now(),
        total: sources.length,
        healthy: sources.filter((source) => source.status === "healthy").length,
        failing: sources.filter((source) => source.status === "failing").length,
        idle: sources.filter((source) => source.status === "idle").length,
        cacheDegraded: sources.filter((source) => source.cacheDegraded).length,
        ...(sampleWindowStartedAt !== undefined ? { sampleWindowStartedAt } : {}),
        sources,
    };
}

function createEmptyQuality(): SourceHealthQuality {
    return {
        rawItemCount: 0,
        validItemCount: 0,
        invalidItemCount: 0,
        duplicateItemCount: 0,
        publishedItemCount: 0,
        emptyResultCount: 0,
    };
}

function persistSourceHealthEvent(id: SourceID, event: ServerSourceHealthEvent) {
    void getSourceHealthEventsTable()
        .then((table) => table?.append(id, event, RECENT_EVENT_LIMIT))
        .catch((error) => logger.warn(`persist ${id} source health event failed`, error));
}
