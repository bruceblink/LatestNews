import { it, expect, describe } from "vitest";

import { formatReadingHistoryExport } from "../shared/history-export";

describe("formatReadingHistoryExport", () => {
    it("formats reading history items for clipboard export", () => {
        const text = formatReadingHistoryExport(
            [
                {
                    title: "第一条新闻",
                    sourceName: "少数派",
                    url: "https://example.com/a",
                    readAt: 1_700_000_000_000,
                },
                {
                    title: "第二条新闻",
                    sourceName: "V2EX",
                    url: "https://example.com/b",
                    readAt: 1_700_000_100_000,
                },
            ],
            {
                formatReadAt: (readAt) => `time:${readAt}`,
            }
        );

        expect(text).toBe(
            [
                "1. 第一条新闻",
                "来源：少数派",
                "阅读时间：time:1700000000000",
                "链接：https://example.com/a",
                "",
                "2. 第二条新闻",
                "来源：V2EX",
                "阅读时间：time:1700000100000",
                "链接：https://example.com/b",
            ].join("\n")
        );
    });

    it("keeps legacy history text but does not export invalid links", () => {
        const text = formatReadingHistoryExport([
            { title: "Legacy", sourceName: "Example", url: "file:///legacy", readAt: 1 },
        ]);
        expect(text).toContain("Legacy");
        expect(text).toContain("（无效链接）");
        expect(text).not.toContain("file://");
    });

    it("returns empty text for empty history", () => {
        expect(formatReadingHistoryExport([])).toBe("");
    });
});
