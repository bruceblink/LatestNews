import type { SourceID } from "@shared/types";

import { it, expect, describe } from "vitest";

import { filterReadingHistory, hasReadingHistoryFilters } from "../shared/history-filter";

const history = [
    {
        title: "AI 产品更新",
        sourceName: "少数派",
        sourceId: "sspai" as SourceID,
    },
    {
        title: "市场快讯",
        sourceName: "金十数据",
        sourceId: "jin10" as SourceID,
    },
    {
        title: "开发者讨论",
        sourceName: "V2EX",
        sourceId: "v2ex-share" as SourceID,
    },
];

describe("reading history filters", () => {
    it("filters history by keyword across title and source name", () => {
        expect(filterReadingHistory(history, { keyword: "AI" }).map((item) => item.sourceId)).toEqual(["sspai"]);
        expect(filterReadingHistory(history, { keyword: "金十" }).map((item) => item.sourceId)).toEqual(["jin10"]);
    });

    it("filters history by source id", () => {
        expect(filterReadingHistory(history, { sourceId: "v2ex-share" as SourceID }).map((item) => item.title)).toEqual(
            ["开发者讨论"]
        );
    });

    it("combines keyword and source filters", () => {
        expect(
            filterReadingHistory(history, { keyword: "快讯", sourceId: "jin10" as SourceID }).map((item) => item.title)
        ).toEqual(["市场快讯"]);
        expect(filterReadingHistory(history, { keyword: "快讯", sourceId: "sspai" as SourceID })).toEqual([]);
    });

    it("detects active filters after trimming keyword", () => {
        expect(hasReadingHistoryFilters({ keyword: "   " })).toBe(false);
        expect(hasReadingHistoryFilters({ keyword: "AI" })).toBe(true);
        expect(hasReadingHistoryFilters({ sourceId: "sspai" as SourceID })).toBe(true);
    });
});
