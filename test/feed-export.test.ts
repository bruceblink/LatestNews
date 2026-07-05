import type { SourceID, SourceResponse } from "@shared/types";
import type { SourceBatchResponse } from "@shared/source-api";

import { it, expect, describe } from "vitest";

import { createJsonFeed, createRssFeedXml, collectFeedItems } from "../shared/feed-export";

const NOW = Date.parse("2026-07-05T08:00:00.000Z");

function createResponse(id: SourceID, sourceName: string, offset: number): SourceResponse {
    return {
        id,
        name: sourceName,
        status: "success",
        updatedTime: NOW,
        items: [
            {
                id: `${id}-news`,
                title: `${sourceName} <headline>`,
                url: `https://example.com/${id}`,
                pubDate: NOW + offset,
                extra: {
                    hover: `${sourceName} summary`,
                },
            },
        ],
    };
}

function createBatchResponse(): SourceBatchResponse {
    return {
        data: [createResponse("weibo" as SourceID, "微博", 1000), createResponse("jin10" as SourceID, "金十", 0)],
        meta: {
            generatedAt: NOW,
            requestedSourceCount: 2,
            resolvedSourceCount: 2,
            partial: false,
            omittedSourceIds: [],
            itemCount: 2,
            unfilteredItemCount: 2,
            filters: {
                sourceIds: ["weibo", "jin10"] as SourceID[],
                columns: [],
                types: [],
            },
        },
        errors: [],
    };
}

describe("feed export", () => {
    it("collects feed items in reverse chronological order", () => {
        expect(collectFeedItems(createBatchResponse()).map((item) => item.sourceId)).toEqual(["weibo", "jin10"]);
    });

    it("creates JSON Feed 1.1 output", () => {
        const feed = createJsonFeed(createBatchResponse(), {
            title: "LatestNews Test",
            siteUrl: "https://news.example.com",
            feedUrl: "https://news.example.com/api/v1/feeds/json?source=weibo",
            generatedAt: NOW,
        });

        expect(feed.version).toBe("https://jsonfeed.org/version/1.1");
        expect(feed.items[0]).toMatchObject({
            id: "weibo:weibo-news",
            title: "微博 <headline>",
            url: "https://example.com/weibo",
            content_text: "微博 summary",
            date_published: "2026-07-05T08:00:01.000Z",
            authors: [{ name: "微博" }],
            _latestnews: {
                source_id: "weibo",
                source_name: "微博",
            },
        });
    });

    it("creates escaped RSS 2.0 XML output", () => {
        const xml = createRssFeedXml(createBatchResponse(), {
            title: "LatestNews Test",
            description: "Readable feed",
            siteUrl: "https://news.example.com",
            feedUrl: "https://news.example.com/api/v1/feeds/rss?source=weibo",
            generatedAt: NOW,
        });

        expect(xml).toContain('<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">');
        expect(xml).toContain("<title>微博 &lt;headline&gt;</title>");
        expect(xml).toContain('<guid isPermaLink="false">weibo:weibo-news</guid>');
        expect(xml).toContain("<description>微博 summary</description>");
        expect(xml).toContain("<lastBuildDate>Sun, 05 Jul 2026 08:00:00 GMT</lastBuildDate>");
    });
});
