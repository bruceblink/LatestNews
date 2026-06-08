import { it, expect, describe } from "vitest";

import { parseRssXml } from "./rss2json";

describe("parseRssXml", () => {
    it("parses rss items with media and namespaced fields", () => {
        const feed = parseRssXml(`
            <rss version="2.0">
                <channel>
                    <title>Example RSS</title>
                    <description>Daily updates</description>
                    <link>https://example.com</link>
                    <lastBuildDate>Mon, 08 Jun 2026 10:00:00 GMT</lastBuildDate>
                    <item>
                        <guid>article-1</guid>
                        <title>First article</title>
                        <description>Summary</description>
                        <link>https://example.com/article-1</link>
                        <pubDate>Mon, 08 Jun 2026 09:00:00 GMT</pubDate>
                        <content:encoded><![CDATA[Full content]]></content:encoded>
                        <media:thumbnail url="https://example.com/thumb.png" />
                        <itunes:duration>01:02:03</itunes:duration>
                    </item>
                </channel>
            </rss>
        `);

        expect(feed?.title).toBe("Example RSS");
        expect(feed?.items).toHaveLength(1);
        expect(feed?.items[0]).toMatchObject({
            id: "article-1",
            title: "First article",
            description: "Summary",
            link: "https://example.com/article-1",
            content: "Full content",
            itunes_duration: "01:02:03",
        });
        expect(feed?.items[0].enclosures).toEqual([{ url: "https://example.com/thumb.png" }]);
    });

    it("parses atom entries with href links and author names", () => {
        const feed = parseRssXml(`
            <feed>
                <title>Example Atom</title>
                <link href="https://example.com/feed" />
                <updated>2026-06-08T10:00:00Z</updated>
                <entry>
                    <id>tag:example.com,2026:1</id>
                    <title>Atom article</title>
                    <summary>Atom summary</summary>
                    <link href="https://example.com/atom-article" />
                    <updated>2026-06-08T09:30:00Z</updated>
                    <author>
                        <name>Alice</name>
                    </author>
                </entry>
            </feed>
        `);

        expect(feed?.link).toBe("https://example.com/feed");
        expect(feed?.updatedTime).toBe("2026-06-08T10:00:00Z");
        expect(feed?.items[0]).toMatchObject({
            id: "tag:example.com,2026:1",
            title: "Atom article",
            description: "Atom summary",
            link: "https://example.com/atom-article",
            author: "Alice",
            created: "2026-06-08T09:30:00Z",
        });
    });
});
