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

    it("returns empty text for empty history", () => {
        expect(formatReadingHistoryExport([])).toBe("");
    });
});
