import { it, expect, describe } from "vitest";

import { normalizeCrawlerItems } from "../crawler-platform/core/output";
import { normalizeNewsItemsWithQuality } from "../shared/news-item-schema";
import { safeNewsUrl, newsLinkHref, filterSafeNewsItemLinks } from "../shared/news-url-policy";

describe("article URL policy", () => {
    const invalid = [
        "file:///tmp/article",
        "javascript:alert(1)",
        "data:text/plain,article",
        "mailto:user@example.test",
        "//example.test/a",
        "/article",
        "https:/example.test/a",
        "https:///example.test/a",
        "https://user:pass@example.test/a",
        "https://@example.test/a",
        "https://example.test:bad/a",
        "https://example.test/a b",
        "https://example.test/a\\b",
        "https://example.test/a\n",
        "https://example.test/" + "x".repeat(4096),
        "",
        null,
        17,
    ];
    it("rejects unsafe schemes, ambiguous syntax, credentials, control characters and oversized URLs", () => {
        for (const url of invalid) expect(safeNewsUrl(url), String(url)).toBeUndefined();
    });
    it("preserves absolute HTTP(S) identity and accepts Unicode and escaped paths", () => {
        for (const url of [
            "https://example.test/新闻?q=a%20b#x",
            "http://127.0.0.1:4444/article",
            "HTTPS://EXAMPLE.test/a",
        ]) {
            expect(safeNewsUrl(" " + url + " ")).toBe(url);
        }
    });
    it("drops invalid mobile links and preserves primary identity and original objects", () => {
        const original = { id: 1, title: "Example", url: "https://example.test/a", mobileUrl: "file:///legacy" };
        expect(filterSafeNewsItemLinks([original])).toEqual([{ id: 1, title: "Example", url: original.url }]);
        expect(original.mobileUrl).toBe("file:///legacy");
        expect(newsLinkHref(original.url, original.mobileUrl)).toBe(original.url);
        expect(newsLinkHref("file:///legacy", original.url)).toBeUndefined();
    });
    it("accounts for invalid legacy-source items and keeps valid mobile fallback", () => {
        const result = normalizeNewsItemsWithQuality([
            { title: "Unsafe", url: "file:///legacy" },
            { title: "Good", url: "https://example.test/a", mobileUrl: "data:text/plain,a" },
            { title: "Duplicate", url: "https://www.example.test/a" },
        ]);
        expect(result.quality).toMatchObject({
            rawItemCount: 3,
            invalidItemCount: 1,
            validItemCount: 1,
            duplicateItemCount: 1,
        });
        expect(result.items).toHaveLength(1);
        expect(result.items[0].mobileUrl).toBeUndefined();
    });
    it("uses the same URL boundary for trusted plugin output without loosening primary validation", () => {
        const options = { sourceKey: "org.latestnews.example-json/latest" as const };
        expect(() => normalizeCrawlerItems([{ title: "Unsafe", url: "https:///example.test/a" }], options)).toThrow();
        expect(() => normalizeCrawlerItems([{ title: "Unsafe", url: "file:///legacy" }], options)).toThrow();
        expect(
            normalizeCrawlerItems(
                [{ title: "Safe", url: "https://example.test/a", mobileUrl: "file:///legacy" }],
                options
            )[0]
        ).not.toHaveProperty("mobileUrl");
    });
});
