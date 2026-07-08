import type { NewsItem, SourceID, SourceResponse } from "@shared/types";

import { it, expect, describe } from "vitest";

import {
    isUnifiedFeedScope,
    createUnifiedFeedView,
    collectUnifiedFeedItems,
    getUnifiedFeedScopeSources,
    normalizeUnifiedFeedSearch,
    normalizeUnifiedFeedFilters,
} from "../shared/unified-feed";

const NOW = Date.parse("2026-07-05T08:00:00.000Z");

function createResponse(id: SourceID, name: string, items: NewsItem[]): SourceResponse {
    return {
        status: "success",
        id,
        name,
        updatedTime: NOW,
        items,
    };
}

function createItem(id: string, title: string, minutesAgo: number): NewsItem {
    return {
        id,
        title,
        url: `https://example.com/${id}`,
        pubDate: NOW - minutesAgo * 60 * 1000,
    };
}

describe("unified feed helpers", () => {
    it("resolves source scopes while filtering redirects", () => {
        expect(isUnifiedFeedScope("focus")).toBe(true);
        expect(isUnifiedFeedScope("unknown")).toBe(false);
        expect(getUnifiedFeedScopeSources("focus", ["weibo", "v2ex"] as SourceID[])).toEqual(["weibo", "v2ex-share"]);
        expect(getUnifiedFeedScopeSources("broad", [], 5)).toHaveLength(5);
    });

    it("collects feed items sorted by item or response time", () => {
        const items = collectUnifiedFeedItems([
            createResponse("weibo" as SourceID, "Weibo", [
                createItem("old", "old item", 30),
                createItem("new", "new item", 1),
            ]),
            createResponse("ithome" as SourceID, "IT Home", [
                {
                    id: "undated",
                    title: "undated item",
                    url: "https://example.com/undated",
                },
            ]),
        ]);

        expect(items.map((item) => item.title)).toEqual(["undated item", "new item", "old item"]);
        expect(items[0]).toMatchObject({
            sourceId: "ithome",
            sourceName: "IT Home",
            categoryId: "tech",
            categoryName: "科技",
        });
    });

    it("normalizes filters and creates feed summaries", () => {
        const view = createUnifiedFeedView(
            [
                createResponse("weibo" as SourceID, "Weibo", [
                    createItem("china-ai", "国内 AI 热点", 5),
                    createItem("china-market", "国内市场观察", 10),
                ]),
                createResponse("ithome" as SourceID, "IT Home", [createItem("tech-ai", "AI 产品更新", 3)]),
            ],
            {
                keyword: " AI ",
                categoryId: "tech",
                hiddenUrls: ["https://example.com/tech-ai"],
                since: NOW - 5 * 60 * 1000,
                limit: 1,
            }
        );

        expect(normalizeUnifiedFeedFilters({ sourceId: "missing-source" as SourceID })).toEqual({});
        expect(view.totalItemCount).toBe(3);
        expect(view.filteredItemCount).toBe(0);
        expect(view.items.map((item) => item.id)).toEqual([]);
        expect(view.activeFilters).toMatchObject({
            keyword: "AI",
            categoryId: "tech",
            since: NOW - 5 * 60 * 1000,
            limit: 1,
            hiddenUrls: ["https://example.com/tech-ai"],
        });
        expect(view.sourceSummaries).toEqual([]);
        expect(view.categorySummaries).toEqual([]);
    });

    it("normalizes deep-link search params for feed filters", () => {
        expect(
            normalizeUnifiedFeedSearch({
                q: " AI ",
                scope: "broad",
                source: "weibo",
                category: "china",
                since: "3d",
            })
        ).toEqual({
            q: "AI",
            scope: "broad",
            source: "weibo",
            category: "china",
            since: "3d",
        });

        expect(
            normalizeUnifiedFeedSearch({
                q: " ",
                scope: "missing",
                source: "missing-source",
                category: "missing",
                since: "30d",
            })
        ).toEqual({});
    });
});
