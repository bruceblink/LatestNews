import type { SourceID } from "@shared/types";

import { it, expect, describe } from "vitest";

import {
    createOfflineReadingSnapshot,
    isFreshOfflineReadingSnapshot,
    migrateOfflineReadingSnapshot,
    getOfflineReadingSnapshotState,
    normalizeOfflineReadingHistory,
    shouldUseOfflineReadingSnapshot,
    normalizeOfflineReadingFocusSources,
} from "../shared/offline-reading-state";

const NOW = Date.parse("2026-08-09T12:00:00.000Z");

describe("offline reading snapshot", () => {
    it("normalizes and bounds history, favorites, and focus sources", () => {
        const snapshot = createOfflineReadingSnapshot(
            {
                history: [
                    {
                        newsId: "old",
                        title: "Old copy",
                        url: "https://m.example.com/news/1?utm_source=feed",
                        sourceId: "weibo" as SourceID,
                        sourceName: "微博",
                        readAt: 10,
                    },
                    {
                        newsId: "new",
                        title: "New copy",
                        url: "https://www.example.com/news/1?ref=sync",
                        sourceId: "weibo" as SourceID,
                        sourceName: "微博",
                        readAt: 20,
                    },
                ],
                favorites: [
                    {
                        newsId: "favorite-old",
                        title: "Old favorite",
                        url: "https://example.com/favorite?utm_source=feed",
                        sourceId: "weibo" as SourceID,
                        sourceName: "微博",
                        updatedAt: 10,
                    },
                    {
                        newsId: "favorite-new",
                        title: "New favorite",
                        url: "https://www.example.com/favorite?ref=sync",
                        sourceId: "weibo" as SourceID,
                        sourceName: "微博",
                        updatedAt: 20,
                    },
                ],
                focusSources: ["weibo", "v2ex", "weibo"] as SourceID[],
            },
            NOW
        );

        expect(snapshot).toMatchObject({ version: 1, savedAt: NOW, focusSources: ["weibo", "v2ex"] });
        expect(snapshot.history).toEqual([expect.objectContaining({ newsId: "new", readAt: 20 })]);
        expect(snapshot.favorites).toEqual([expect.objectContaining({ newsId: "favorite-new", updatedAt: 20 })]);
    });

    it("uses deterministic URL ordering and limits for stored history", () => {
        const history = [
            {
                newsId: "b",
                title: "B",
                url: "https://example.com/b",
                sourceId: "weibo" as SourceID,
                sourceName: "微博",
                readAt: 10,
            },
            {
                newsId: "a",
                title: "A",
                url: "https://example.com/a",
                sourceId: "weibo" as SourceID,
                sourceName: "微博",
                readAt: 10,
            },
        ];

        expect(normalizeOfflineReadingHistory(history, 1).map((item) => item.newsId)).toEqual(["a"]);
        expect(normalizeOfflineReadingFocusSources(["weibo", "v2ex", "weibo"] as SourceID[], 1)).toEqual(["weibo"]);
    });

    it("labels fresh, stale, future, and malformed snapshots distinctly", () => {
        const snapshot = createOfflineReadingSnapshot(
            { history: [], favorites: [], focusSources: ["weibo"] as SourceID[] },
            NOW
        );

        expect(getOfflineReadingSnapshotState(snapshot, NOW)).toBe("fresh");
        expect(isFreshOfflineReadingSnapshot(snapshot, NOW)).toBe(true);
        expect(getOfflineReadingSnapshotState(snapshot, NOW + 8 * 24 * 60 * 60 * 1000)).toBe("stale");
        expect(getOfflineReadingSnapshotState({ ...snapshot, savedAt: NOW + 2 * 60 * 1000 }, NOW)).toBe("invalid");
        expect(getOfflineReadingSnapshotState({ ...snapshot, version: 2 }, NOW)).toBe("invalid");
    });

    it("migrates only the current schema and safely drops damaged records", () => {
        const snapshot = createOfflineReadingSnapshot(
            {
                history: [
                    {
                        newsId: "valid",
                        title: "Valid",
                        url: "https://example.com/valid",
                        sourceId: "weibo" as SourceID,
                        sourceName: "微博",
                        readAt: 1,
                    },
                ],
                favorites: [],
                focusSources: ["weibo"] as SourceID[],
            },
            NOW
        );

        expect(migrateOfflineReadingSnapshot(snapshot)).toEqual(snapshot);
        expect(migrateOfflineReadingSnapshot({ ...snapshot, version: 0 })).toBeUndefined();
        expect(migrateOfflineReadingSnapshot({ ...snapshot, history: "damaged" })).toBeUndefined();
    });

    it("uses a fresh or stale snapshot only when offline primary storage is unavailable", () => {
        expect(
            shouldUseOfflineReadingSnapshot({
                isOffline: true,
                hasPersistedLiveValue: false,
                snapshotState: "fresh",
            })
        ).toBe(true);
        expect(
            shouldUseOfflineReadingSnapshot({
                isOffline: true,
                hasPersistedLiveValue: false,
                snapshotState: "stale",
            })
        ).toBe(true);
        expect(
            shouldUseOfflineReadingSnapshot({
                isOffline: false,
                hasPersistedLiveValue: false,
                snapshotState: "fresh",
            })
        ).toBe(false);
        expect(
            shouldUseOfflineReadingSnapshot({
                isOffline: true,
                hasPersistedLiveValue: true,
                snapshotState: "fresh",
            })
        ).toBe(false);
        expect(
            shouldUseOfflineReadingSnapshot({
                isOffline: true,
                hasPersistedLiveValue: false,
                snapshotState: "invalid",
            })
        ).toBe(false);
    });
});
