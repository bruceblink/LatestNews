import type { NewsItem } from "@shared/types";

import { it, expect, describe } from "vitest";

import { filterSourceItems, parseSourceItemsSince, normalizeSourceItemsLimit } from "../shared/source-items";

const NOW = Date.parse("2026-07-05T08:00:00.000Z");

function createItem(id: string, pubDate?: number): NewsItem {
    return {
        id,
        title: `title ${id}`,
        url: `https://example.com/${id}`,
        pubDate,
    };
}

describe("source items helpers", () => {
    it("normalizes limit values with a max guard", () => {
        expect(normalizeSourceItemsLimit("20")).toBe(20);
        expect(normalizeSourceItemsLimit(200, 100)).toBe(100);
        expect(normalizeSourceItemsLimit("0")).toBeUndefined();
        expect(normalizeSourceItemsLimit("bad")).toBeUndefined();
    });

    it("parses numeric and ISO since values", () => {
        expect(parseSourceItemsSince(NOW)).toBe(NOW);
        expect(parseSourceItemsSince(String(NOW))).toBe(NOW);
        expect(parseSourceItemsSince("2026-07-05T08:00:00.000Z")).toBe(NOW);
        expect(parseSourceItemsSince("bad")).toBeUndefined();
    });

    it("filters by since and limit while keeping undated items", () => {
        const items = [
            createItem("old", NOW - 10_000),
            createItem("new", NOW),
            createItem("undated"),
            createItem("latest", NOW + 10_000),
        ];

        expect(filterSourceItems(items, { since: NOW, limit: 2 }).map((item) => item.id)).toEqual(["new", "undated"]);
    });
});
