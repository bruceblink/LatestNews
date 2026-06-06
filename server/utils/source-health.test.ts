import type { SourceID } from "@shared/types";

import { it, expect, describe } from "vitest";

import {
    recordSourceFailure,
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
});
