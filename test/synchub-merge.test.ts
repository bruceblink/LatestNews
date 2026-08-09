import type { SourceID, PrimitiveMetadata } from "@shared/types";

import { it, expect, describe } from "vitest";

import {
    mergeSyncHubFavorites,
    mergeSyncHubPreferences,
    type SyncHubPreferences,
    mergeSyncHubReadingHistory,
} from "../shared/synchub-merge";

function createMetadata(updatedTime: number): PrimitiveMetadata {
    return {
        updatedTime,
        action: "manual",
        data: {
            focus: ["weibo" as SourceID],
            hottest: ["zhihu" as SourceID],
            realtime: ["jin10" as SourceID],
        },
    };
}

describe("SyncHub merge policy", () => {
    it("deduplicates history by normalized URL and keeps local ties", () => {
        const local = [
            {
                url: "https://m.example.com/news/1?utm_source=local",
                title: "Local copy",
                readAt: 20,
            },
            { url: "https://example.com/news/2", title: "Old local copy", readAt: 10 },
        ];
        const remote = [
            {
                url: "https://www.example.com/news/1?ref=remote",
                title: "Remote tie",
                readAt: 20,
            },
            { url: "https://example.com/news/2", title: "New remote copy", readAt: 30 },
            { url: "https://example.com/news/3", title: "Remote only", readAt: 5 },
        ];

        const merged = mergeSyncHubReadingHistory(local, remote);

        expect(merged).toEqual([
            { url: "https://example.com/news/2", title: "New remote copy", readAt: 30 },
            { url: "https://m.example.com/news/1?utm_source=local", title: "Local copy", readAt: 20 },
            { url: "https://example.com/news/3", title: "Remote only", readAt: 5 },
        ]);
        expect(local[0].title).toBe("Local copy");
        expect(remote[0].title).toBe("Remote tie");
    });

    it("keeps local history when the remote collection is empty and enforces a limit", () => {
        const local = [
            { url: "https://example.com/1", readAt: 1 },
            { url: "https://example.com/2", readAt: 2 },
            { url: "https://example.com/3", readAt: 3 },
        ];

        expect(mergeSyncHubReadingHistory(local, [], 2)).toEqual([
            { url: "https://example.com/3", readAt: 3 },
            { url: "https://example.com/2", readAt: 2 },
        ]);
    });

    it("merges favorite unions by latest updatedAt and keeps deterministic order", () => {
        const local = [
            { url: "https://example.com/a", updatedAt: 10, title: "Local A" },
            { url: "https://example.com/b", updatedAt: 20, title: "Local B" },
        ];
        const remote = [
            { url: "https://m.example.com/a?utm_medium=sync", updatedAt: 30, title: "Remote A" },
            { url: "https://example.com/c", updatedAt: 15, title: "Remote C" },
        ];

        expect(mergeSyncHubFavorites(local, remote)).toEqual([
            { url: "https://m.example.com/a?utm_medium=sync", updatedAt: 30, title: "Remote A" },
            { url: "https://example.com/b", updatedAt: 20, title: "Local B" },
            { url: "https://example.com/c", updatedAt: 15, title: "Remote C" },
        ]);
    });

    it("chooses newer metadata and preference timestamps independently", () => {
        const local: SyncHubPreferences = {
            colorScheme: "dark",
            metadata: createMetadata(10),
            updatedAt: 100,
        };
        const remote: SyncHubPreferences = {
            colorScheme: "light",
            metadata: createMetadata(20),
            updatedAt: 200,
        };

        expect(mergeSyncHubPreferences(local, remote)).toEqual(remote);
    });

    it("does not let a legacy remote preference overwrite a timestamped local value", () => {
        const local: SyncHubPreferences = {
            colorScheme: "dark",
            metadata: createMetadata(20),
            updatedAt: 200,
        };
        const legacyRemote: Partial<SyncHubPreferences> = {
            colorScheme: "light",
            metadata: createMetadata(10),
        };

        expect(mergeSyncHubPreferences(local, legacyRemote)).toEqual(local);
    });

    it("prefers local values when preference timestamps tie", () => {
        const local: SyncHubPreferences = {
            colorScheme: "dark",
            metadata: createMetadata(20),
            updatedAt: 200,
        };
        const remote: SyncHubPreferences = {
            colorScheme: "light",
            metadata: createMetadata(20),
            updatedAt: 200,
        };

        expect(mergeSyncHubPreferences(local, remote)).toEqual(local);
    });
});
