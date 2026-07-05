import type { NewsItem, SourceID, SourceResponse } from "@shared/types";

import { it, expect, describe } from "vitest";
import { normalizeNewsUrl, createNewsInsights, extractInsightTerms } from "@shared/news-insights";

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

function createItem(id: string, title: string, url: string, minutesAgo: number): NewsItem {
    return {
        id,
        title,
        url,
        pubDate: NOW - minutesAgo * 60 * 1000,
    };
}

describe("news insights", () => {
    it("normalizes URLs by removing common tracking parameters", () => {
        expect(normalizeNewsUrl("https://m.example.com/news/1/?utm_source=feed&foo=bar#comments")).toBe(
            "https://example.com/news/1/?foo=bar"
        );
    });

    it("extracts searchable English and Chinese terms", () => {
        expect(extractInsightTerms("OpenAI 发布 GPT-5 模型，AI芯片需求激增")).toEqual(
            expect.arrayContaining(["openai", "gpt-5", "ai", "模型", "芯片需求激增", "芯片", "需求", "激增"])
        );
    });

    it("builds explainable hot rankings from source coverage and recency", () => {
        const insights = createNewsInsights(
            [
                createResponse("weibo" as SourceID, "Weibo", [
                    createItem(
                        "weibo-gpt",
                        "OpenAI 发布 GPT-5 模型",
                        "https://news.example.com/gpt5?utm_source=weibo",
                        30
                    ),
                    createItem("weibo-chip", "AI芯片需求激增", "https://news.example.com/chips", 1),
                ]),
                createResponse("v2ex" as SourceID, "V2EX", [
                    createItem("v2ex-gpt", "GPT-5 发布，OpenAI 更新模型", "https://news.example.com/gpt5?ref=v2ex", 10),
                ]),
            ],
            {
                generatedAt: NOW,
                sourceWeights: {
                    v2ex: 1.2,
                    weibo: 1,
                },
            }
        );

        expect(insights.itemCount).toBe(3);
        expect(insights.hotRankings[0]).toMatchObject({
            title: "GPT-5 发布，OpenAI 更新模型",
            itemCount: 2,
            signals: {
                sourceCoverage: 2,
                duplicateCount: 2,
            },
        });
        expect(insights.hotRankings[0].sources).toEqual(expect.arrayContaining(["weibo", "v2ex"]));
        expect(insights.hotRankings[0].score).toBeGreaterThan(insights.hotRankings[1].score);
    });

    it("groups related topic events by URL or overlapping title terms", () => {
        const insights = createNewsInsights(
            [
                createResponse("weibo" as SourceID, "Weibo", [
                    createItem(
                        "weibo-gpt",
                        "OpenAI 发布 GPT-5 模型",
                        "https://news.example.com/gpt5?utm_source=weibo",
                        30
                    ),
                ]),
                createResponse("v2ex" as SourceID, "V2EX", [
                    createItem("v2ex-gpt", "GPT-5 发布，OpenAI 更新模型", "https://news.example.com/gpt5?ref=v2ex", 10),
                ]),
                createResponse("ithome" as SourceID, "IT Home", [
                    createItem("ithome-gpt", "OpenAI GPT-5 模型能力解读", "https://ithome.example.com/openai-gpt5", 20),
                ]),
            ],
            { generatedAt: NOW }
        );

        expect(insights.topicEvents).toHaveLength(1);
        expect(insights.topicEvents[0].itemCount).toBe(3);
        expect(insights.topicEvents[0].sources).toEqual(expect.arrayContaining(["weibo", "v2ex", "ithome"]));
        expect(insights.topicEvents[0].keywords).toEqual(expect.arrayContaining(["openai", "gpt-5"]));
        expect(insights.topicEvents[0].firstPublishedAt).toBe(NOW - 30 * 60 * 1000);
        expect(insights.topicEvents[0].latestPublishedAt).toBe(NOW - 10 * 60 * 1000);
    });

    it("creates word cloud and source activity summaries", () => {
        const insights = createNewsInsights(
            [
                createResponse("weibo" as SourceID, "Weibo", [
                    createItem("weibo-gpt", "OpenAI 发布 GPT-5 模型", "https://news.example.com/gpt5", 30),
                    createItem("weibo-chip", "AI芯片需求激增", "https://news.example.com/chips", 1),
                ]),
                createResponse("v2ex" as SourceID, "V2EX", [
                    createItem("v2ex-gpt", "OpenAI GPT-5 模型更新", "https://v2ex.example.com/gpt5", 10),
                ]),
            ],
            { generatedAt: NOW }
        );

        const openai = insights.wordCloud.find((item) => item.term === "openai");
        expect(openai).toMatchObject({
            count: 2,
            sources: ["weibo", "v2ex"],
        });
        expect(insights.sourceActivity).toEqual([
            expect.objectContaining({ sourceId: "weibo", itemCount: 2 }),
            expect.objectContaining({ sourceId: "v2ex", itemCount: 1 }),
        ]);
    });

    it("summarizes category shares by source metadata", () => {
        const insights = createNewsInsights(
            [
                createResponse("weibo" as SourceID, "Weibo", [
                    createItem("weibo-1", "国内热点更新", "https://news.example.com/china-1", 5),
                    createItem("weibo-2", "国内热点追踪", "https://news.example.com/china-2", 6),
                ]),
                createResponse("v2ex" as SourceID, "V2EX", [
                    createItem("v2ex-1", "开发者讨论 OpenAI", "https://v2ex.example.com/openai", 8),
                ]),
            ],
            { generatedAt: NOW }
        );

        expect(insights.categoryShares).toEqual([
            expect.objectContaining({
                categoryId: "china",
                categoryName: "国内",
                itemCount: 2,
                sourceCount: 1,
                ratio: 0.67,
            }),
            expect.objectContaining({
                categoryId: "tech",
                categoryName: "科技",
                itemCount: 1,
                sourceCount: 1,
                ratio: 0.33,
            }),
        ]);
    });
});
