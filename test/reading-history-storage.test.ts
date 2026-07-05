import type { Atom } from "jotai/vanilla";

import { createStore } from "jotai/vanilla";
import { it, vi, expect, describe, afterEach } from "vitest";

describe("readingHistoryAtom", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.resetModules();
    });

    it("reads persisted history before the first atom value is used", async () => {
        const storedHistory = [
            {
                newsId: "weibo-1",
                title: "Persisted news",
                url: "https://example.com/news",
                sourceId: "weibo",
                sourceName: "微博",
                readAt: Date.parse("2026-07-05T08:00:00.000Z"),
            },
        ];
        const localStorage = {
            getItem: vi.fn((key: string) => (key === "reading-history" ? JSON.stringify(storedHistory) : null)),
            removeItem: vi.fn(),
            setItem: vi.fn(),
        };

        vi.stubGlobal("window", { localStorage });
        vi.resetModules();

        const historyAtomModuleUrl = new URL("../src/atoms/historyAtom.ts", import.meta.url).href;
        const { readingHistoryAtom } = (await import(historyAtomModuleUrl)) as { readingHistoryAtom: Atom<unknown> };
        const store = createStore();

        expect(store.get(readingHistoryAtom)).toEqual(storedHistory);
        expect(localStorage.getItem).toHaveBeenCalledWith("reading-history");
    });
});
