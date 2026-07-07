import type { SourceID } from "@shared/types";

import { it, expect, describe } from "vitest";
import {
    isHiddenReadingUrl,
    hasReadingStateItem,
    normalizeReadingState,
    removeReadingStateItem,
    toggleReadingStateItem,
    normalizeReadingStateUrl,
} from "@shared/reading-state";

const entry = {
    newsId: "weibo-1",
    title: "Tracked news",
    url: "https://m.example.com/news/1?utm_source=feed&foo=bar#comments",
    sourceId: "weibo" as SourceID,
    sourceName: "微博",
};

describe("reading state helpers", () => {
    it("normalizes URLs before matching reading lists", () => {
        expect(normalizeReadingStateUrl(entry.url)).toBe("https://example.com/news/1?foo=bar");

        const state = toggleReadingStateItem(undefined, "later", entry, 1);
        expect(hasReadingStateItem(state, "later", "https://www.example.com/news/1?foo=bar")).toBe(true);
    });

    it("toggles later, favorite, and hidden states independently", () => {
        const withLater = toggleReadingStateItem(undefined, "later", entry, 1);
        const withFavorite = toggleReadingStateItem(withLater, "favorite", entry, 2);

        expect(withFavorite.later).toHaveLength(1);
        expect(withFavorite.favorites).toHaveLength(1);

        const hidden = toggleReadingStateItem(withFavorite, "hidden", entry, 3);
        expect(hidden.later).toHaveLength(0);
        expect(hidden.favorites).toHaveLength(0);
        expect(isHiddenReadingUrl(hidden, entry.url)).toBe(true);

        const restored = toggleReadingStateItem(hidden, "favorite", entry, 4);
        expect(restored.hidden).toHaveLength(0);
        expect(restored.favorites).toHaveLength(1);
    });

    it("removes a saved state item by normalized URL", () => {
        const state = toggleReadingStateItem(undefined, "favorite", entry, 1);
        const nextState = removeReadingStateItem(state, "favorite", "https://www.example.com/news/1?foo=bar");

        expect(nextState.favorites).toEqual([]);
    });

    it("deduplicates and sorts persisted entries", () => {
        const state = normalizeReadingState({
            later: [
                { ...entry, updatedAt: 1 },
                { ...entry, title: "duplicate", updatedAt: 2 },
                {
                    newsId: "ithome-1",
                    title: "Second",
                    url: "https://example.com/second",
                    sourceId: "ithome" as SourceID,
                    sourceName: "IT之家",
                    updatedAt: 3,
                },
            ],
        });

        expect(state.later.map((item) => item.title)).toEqual(["Second", "duplicate"]);
    });
});
