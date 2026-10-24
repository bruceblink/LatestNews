import type { SourceID } from "@shared/types";

import { it, vi, expect, describe } from "vitest";

vi.mock("../database/source-health-events", () => ({ getSourceHealthEventsTable: async () => undefined }));

import {
    recordSourceFailure,
    recordSourceQuality,
    recordSourceSuccess,
    getSourceHealthSummary,
    getSourceHealthSnapshot,
} from "./source-health";

describe("source health cache degradation", () => {
    const sourceId = "weibo" as SourceID;

    it("marks a failing source as cache degraded after policy threshold", () => {
        recordSourceSuccess(sourceId, 10, 1);
        recordSourceFailure(sourceId, 20, new Error("first failure"));

        expect(getSourceHealthSnapshot(sourceId).cacheDegraded).toBe(false);

        recordSourceFailure(sourceId, 30, new Error("second failure"));

        const snapshot = getSourceHealthSnapshot(sourceId);
        const summarySource = getSourceHealthSummary().sources.find((source) => source.id === sourceId);

        expect(snapshot.cacheDegraded).toBe(true);
        expect(summarySource?.cacheDegraded).toBe(true);
        expect(getSourceHealthSummary().cacheDegraded).toBeGreaterThanOrEqual(1);
    });

    it("clears cache degradation after a successful fetch", () => {
        recordSourceSuccess(sourceId, 15, 2);

        expect(getSourceHealthSnapshot(sourceId).cacheDegraded).toBe(false);
    });

    it("retains only the most recent health events in memory", () => {
        const eventSourceId = "ithome" as SourceID;

        for (let index = 0; index < 25; index += 1) {
            recordSourceSuccess(eventSourceId, index, index);
        }

        const snapshot = getSourceHealthSnapshot(eventSourceId);
        expect(snapshot.recentEvents).toHaveLength(20);
        expect(snapshot.recentEvents[0]).toMatchObject({
            durationMs: 24,
            itemCount: 24,
        });
    });

    it("accumulates quality counters for the current sampling window", () => {
        const qualitySourceId = "juejin" as SourceID;
        const sampledAt = Date.parse("2026-07-05T08:00:00.000Z");

        recordSourceSuccess(qualitySourceId, 25, 2);
        recordSourceQuality(
            qualitySourceId,
            {
                rawItemCount: 4,
                validItemCount: 2,
                invalidItemCount: 1,
                duplicateItemCount: 1,
                publishedItemCount: 1,
                newestPublishedAt: sampledAt - 90_000,
            },
            sampledAt
        );

        const snapshot = getSourceHealthSnapshot(qualitySourceId);
        expect(snapshot.quality).toMatchObject({
            rawItemCount: 4,
            validItemCount: 2,
            invalidItemCount: 1,
            duplicateItemCount: 1,
            publishedItemCount: 1,
            lastFreshnessMs: 90_000,
        });
        expect(getSourceHealthSummary().sampleWindowStartedAt).toBeDefined();
    });
});
