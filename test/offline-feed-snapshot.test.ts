import type { SourceID, SourceResponse } from "@shared/types";
import type { SourceBatchResponse } from "@shared/source-api";

import { it, expect, describe } from "vitest";

import {
    createOfflineFeedSnapshot,
    selectOfflineFeedSnapshot,
    isFreshOfflineFeedSnapshot,
    createOfflineFeedSnapshotKey,
    normalizeOfflineFeedSnapshotSources,
} from "../shared/offline-feed-snapshot";

const NOW = Date.parse("2026-07-05T08:00:00.000Z");

function createResponse(id: SourceID): SourceResponse {
    return {
        id,
        name: id,
        status: "success",
        updatedTime: NOW,
        items: [
            {
                id: `${id}-news`,
                title: `${id} news`,
                url: `https://example.com/${id}`,
                pubDate: NOW,
            },
        ],
    };
}

function createBatchResponse(ids: SourceID[]): SourceBatchResponse {
    return {
        data: ids.map(createResponse),
        meta: {
            generatedAt: NOW,
            requestedSourceCount: ids.length,
            resolvedSourceCount: ids.length,
            partial: false,
            omittedSourceIds: [],
            itemCount: ids.length,
            unfilteredItemCount: ids.length,
            filters: {
                sourceIds: ids,
                columns: [],
                types: [],
            },
        },
        errors: [],
    };
}

describe("offline feed snapshot helpers", () => {
    it("creates stable keys for the same source set", () => {
        const left = createOfflineFeedSnapshotKey({
            scope: "focus",
            since: "24h",
            sources: ["weibo", "jin10", "weibo"] as SourceID[],
        });
        const right = createOfflineFeedSnapshotKey({
            scope: "focus",
            since: "24h",
            sources: ["jin10", "weibo"] as SourceID[],
        });

        expect(left).toBe(right);
        expect(normalizeOfflineFeedSnapshotSources(["weibo", "jin10", "weibo"] as SourceID[])).toEqual([
            "jin10",
            "weibo",
        ]);
    });

    it("creates snapshots with normalized payload metadata", () => {
        const response = createBatchResponse(["weibo" as SourceID]);
        const snapshot = createOfflineFeedSnapshot(
            {
                scope: "focus",
                since: " 24h ",
                sources: ["weibo"] as SourceID[],
            },
            response,
            NOW
        );

        expect(snapshot).toMatchObject({
            version: 1,
            savedAt: NOW,
            sourceIds: ["weibo"],
            scope: "focus",
            since: "24h",
            response,
        });
    });

    it("selects the newest fresh snapshot for the requested payload", () => {
        const oldSnapshot = createOfflineFeedSnapshot(
            { scope: "focus", since: "24h", sources: ["weibo"] as SourceID[] },
            createBatchResponse(["weibo" as SourceID]),
            NOW - 1000
        );
        const freshSnapshot = createOfflineFeedSnapshot(
            { scope: "focus", since: "24h", sources: ["weibo"] as SourceID[] },
            createBatchResponse(["weibo" as SourceID]),
            NOW
        );
        const otherSnapshot = createOfflineFeedSnapshot(
            { scope: "hottest", since: "24h", sources: ["weibo"] as SourceID[] },
            createBatchResponse(["weibo" as SourceID]),
            NOW + 1000
        );

        expect(
            selectOfflineFeedSnapshot(
                [oldSnapshot, freshSnapshot, otherSnapshot],
                { scope: "focus", since: "24h", sources: ["weibo"] as SourceID[] },
                NOW
            )
        ).toBe(freshSnapshot);
    });

    it("rejects expired or empty snapshots", () => {
        const expiredSnapshot = createOfflineFeedSnapshot(
            { scope: "focus", since: "24h", sources: ["weibo"] as SourceID[] },
            createBatchResponse(["weibo" as SourceID]),
            NOW - 8 * 24 * 60 * 60 * 1000
        );
        const emptySnapshot = createOfflineFeedSnapshot(
            { scope: "focus", since: "24h", sources: [] },
            createBatchResponse([]),
            NOW
        );

        expect(isFreshOfflineFeedSnapshot(expiredSnapshot, NOW)).toBe(false);
        expect(isFreshOfflineFeedSnapshot(emptySnapshot, NOW)).toBe(false);
    });
});
