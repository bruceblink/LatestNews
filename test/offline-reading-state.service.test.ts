import type { SourceID } from "@shared/types";
import type { OfflineReadingSnapshotInput } from "@shared/offline-reading-state";

import { it, vi, expect, describe, afterEach } from "vitest";

const NOW = Date.parse("2026-08-09T12:00:00.000Z");

describe("offline reading snapshot storage", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("stores a normalized snapshot separately from feed snapshots", async () => {
        const localStorage = createLocalStorage();
        vi.stubGlobal("localStorage", localStorage);
        const { OFFLINE_READING_SNAPSHOT_STORAGE_KEY, readOfflineReadingSnapshot, saveOfflineReadingSnapshot } =
            await loadService();

        const saved = saveOfflineReadingSnapshot(
            {
                history: [
                    {
                        newsId: "old",
                        title: "Old copy",
                        url: "https://m.example.com/news?utm_source=feed",
                        sourceId: "weibo" as SourceID,
                        sourceName: "微博",
                        readAt: 10,
                    },
                    {
                        newsId: "new",
                        title: "New copy",
                        url: "https://www.example.com/news?ref=sync",
                        sourceId: "weibo" as SourceID,
                        sourceName: "微博",
                        readAt: 20,
                    },
                ],
                favorites: [],
                focusSources: ["weibo", "v2ex", "weibo"] as SourceID[],
            },
            NOW
        );

        expect(saved).toMatchObject({
            savedAt: NOW,
            history: [expect.objectContaining({ newsId: "new" })],
            focusSources: ["weibo", "v2ex"],
        });
        expect(localStorage.setItem).toHaveBeenCalledWith(OFFLINE_READING_SNAPSHOT_STORAGE_KEY, expect.any(String));
        expect(readOfflineReadingSnapshot(NOW)).toEqual({ state: "fresh", snapshot: saved });
    });

    it("returns stale snapshots so the page can label them instead of hiding them", async () => {
        const localStorage = createLocalStorage();
        vi.stubGlobal("localStorage", localStorage);
        const { readOfflineReadingSnapshot, saveOfflineReadingSnapshot } = await loadService();

        saveOfflineReadingSnapshot({ history: [], favorites: [], focusSources: ["weibo"] as SourceID[] }, NOW);

        expect(readOfflineReadingSnapshot(NOW + 8 * 24 * 60 * 60 * 1000)).toMatchObject({
            state: "stale",
            snapshot: expect.objectContaining({ savedAt: NOW }),
        });
    });

    it("ignores corrupted and unknown-version records without throwing", async () => {
        const localStorage = createLocalStorage();
        vi.stubGlobal("localStorage", localStorage);
        const { OFFLINE_READING_SNAPSHOT_STORAGE_KEY, readOfflineReadingSnapshot } = await loadService();

        localStorage.values.set(OFFLINE_READING_SNAPSHOT_STORAGE_KEY, "not json");
        expect(readOfflineReadingSnapshot(NOW)).toEqual({ state: "invalid" });

        localStorage.values.set(OFFLINE_READING_SNAPSHOT_STORAGE_KEY, JSON.stringify({ version: 2 }));
        expect(readOfflineReadingSnapshot(NOW)).toEqual({ state: "invalid" });
    });

    it("handles unavailable browser storage without changing reading state", async () => {
        const { readOfflineReadingSnapshot, saveOfflineReadingSnapshot } = await loadService();
        expect(saveOfflineReadingSnapshot({ history: [], favorites: [], focusSources: [] }, NOW)).toBeUndefined();
        expect(readOfflineReadingSnapshot(NOW)).toEqual({ state: "missing" });

        const localStorage = {
            getItem: vi.fn(() => {
                throw new Error("storage is blocked");
            }),
            setItem: vi.fn(() => {
                throw new Error("quota exceeded");
            }),
        };
        vi.stubGlobal("localStorage", localStorage);

        expect(saveOfflineReadingSnapshot({ history: [], favorites: [], focusSources: [] }, NOW)).toBeUndefined();
        expect(readOfflineReadingSnapshot(NOW)).toEqual({ state: "missing" });
    });
});

interface OfflineReadingSnapshotStorageService {
    OFFLINE_READING_SNAPSHOT_STORAGE_KEY: string;
    readOfflineReadingSnapshot(now?: number): unknown;
    saveOfflineReadingSnapshot(input: OfflineReadingSnapshotInput, savedAt?: number): unknown;
}

/** Loads the browser-only service dynamically so Node's test configuration does not compile app sources. */
async function loadService(): Promise<OfflineReadingSnapshotStorageService> {
    const serviceUrl = new URL("../src/services/offline-reading-state.service.ts", import.meta.url).href;
    return (await import(serviceUrl)) as OfflineReadingSnapshotStorageService;
}

/** Builds a small Storage-shaped fake so each test owns its persisted values. */
function createLocalStorage() {
    const values = new Map<string, string>();

    return {
        values,
        getItem: vi.fn((key: string) => values.get(key) ?? null),
        setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    };
}
