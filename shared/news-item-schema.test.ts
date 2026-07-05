import { it, expect, describe } from "vitest";

import { normalizeNewsItem, normalizeNewsItems, normalizeNewsItemUrlKey } from "./news-item-schema";

import type { NewsItem, SourceID } from "./types";

describe("news item normalization", () => {
    it("normalizes URL keys by removing tracking parameters", () => {
        expect(normalizeNewsItemUrlKey("https://m.example.com/a/1?utm_source=feed&foo=bar#comments")).toBe(
            "https://example.com/a/1?foo=bar"
        );
    });

    it("filters invalid items and deduplicates canonical URLs", () => {
        const items = normalizeNewsItems(
            [
                { id: "", title: "  Valid  ", url: "https://example.com/a?utm_source=feed" },
                { id: "duplicate", title: "Duplicate", url: "https://www.example.com/a" },
                { id: "empty-title", title: "", url: "https://example.com/b" },
                { id: "empty-url", title: "Empty URL", url: "" },
            ],
            { sourceId: "weibo" as SourceID }
        );

        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({
            id: expect.stringMatching(/^weibo:url-/),
            title: "Valid",
            url: "https://example.com/a?utm_source=feed",
        });
    });

    it("keeps valid optional fields and normalizes dates", () => {
        const item = normalizeNewsItem(
            {
                id: 100,
                title: "Title",
                url: "https://example.com/a",
                mobileUrl: " https://m.example.com/a ",
                pubDate: "2026-07-05T08:00:00.000Z",
                extra: {
                    date: "1783220000000",
                    info: "meta",
                },
            } satisfies NewsItem,
            "v2ex" as SourceID
        );

        expect(item).toMatchObject({
            id: 100,
            title: "Title",
            mobileUrl: "https://m.example.com/a",
            pubDate: Date.parse("2026-07-05T08:00:00.000Z"),
            extra: {
                date: 1_783_220_000_000,
                info: "meta",
            },
        });
    });
});
