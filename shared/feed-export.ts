import { parseSourceItemsSince } from "./source-items";

import type { NewsItem } from "./types";
import type { SourceBatchResponse } from "./source-api";

export interface FeedExportOptions {
    title: string;
    description?: string;
    siteUrl: string;
    feedUrl?: string;
    generatedAt?: number;
    maxItems?: number;
}

export interface JsonFeedAuthor {
    name: string;
}

export interface JsonFeedItem {
    id: string;
    url: string;
    title: string;
    content_text?: string;
    date_published?: string;
    authors?: JsonFeedAuthor[];
    _latestnews: {
        source_id: string;
        source_name?: string;
    };
}

export interface JsonFeed {
    version: "https://jsonfeed.org/version/1.1";
    title: string;
    home_page_url: string;
    feed_url?: string;
    description?: string;
    items: JsonFeedItem[];
}

interface FeedItem {
    id: string;
    url: string;
    title: string;
    contentText?: string;
    sourceId: string;
    sourceName?: string;
    publishedAt?: number;
}

const DEFAULT_MAX_FEED_ITEMS = 50;

export function createJsonFeed(response: SourceBatchResponse, options: FeedExportOptions): JsonFeed {
    return {
        version: "https://jsonfeed.org/version/1.1",
        title: options.title,
        home_page_url: options.siteUrl,
        feed_url: options.feedUrl,
        description: options.description,
        items: collectFeedItems(response, options).map((item) => ({
            id: item.id,
            url: item.url,
            title: item.title,
            content_text: item.contentText,
            date_published: formatIsoDate(item.publishedAt),
            authors: item.sourceName ? [{ name: item.sourceName }] : undefined,
            _latestnews: {
                source_id: item.sourceId,
                source_name: item.sourceName,
            },
        })),
    };
}

export function createRssFeedXml(response: SourceBatchResponse, options: FeedExportOptions): string {
    const generatedAt = options.generatedAt ?? response.meta.generatedAt;
    const items = collectFeedItems(response, options)
        .map((item) =>
            [
                "    <item>",
                `      <title>${escapeXml(item.title)}</title>`,
                `      <link>${escapeXml(item.url)}</link>`,
                `      <guid isPermaLink="false">${escapeXml(item.id)}</guid>`,
                item.contentText ? `      <description>${escapeXml(item.contentText)}</description>` : undefined,
                item.sourceName ? `      <author>${escapeXml(item.sourceName)}</author>` : undefined,
                item.publishedAt ? `      <pubDate>${new Date(item.publishedAt).toUTCString()}</pubDate>` : undefined,
                `      <category>${escapeXml(item.sourceName ?? item.sourceId)}</category>`,
                "    </item>",
            ]
                .filter((line): line is string => Boolean(line))
                .join("\n")
        )
        .join("\n");

    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
        "  <channel>",
        `    <title>${escapeXml(options.title)}</title>`,
        `    <link>${escapeXml(options.siteUrl)}</link>`,
        `    <description>${escapeXml(options.description ?? options.title)}</description>`,
        `    <lastBuildDate>${new Date(generatedAt).toUTCString()}</lastBuildDate>`,
        "    <generator>LatestNews</generator>",
        options.feedUrl
            ? `    <atom:link href="${escapeXml(options.feedUrl)}" rel="self" type="application/rss+xml" />`
            : undefined,
        items,
        "  </channel>",
        "</rss>",
    ]
        .filter((line): line is string => Boolean(line))
        .join("\n");
}

export function collectFeedItems(response: SourceBatchResponse, options: Pick<FeedExportOptions, "maxItems"> = {}) {
    const maxItems = options.maxItems ?? DEFAULT_MAX_FEED_ITEMS;
    const items = response.data.flatMap((source) =>
        source.items.map((item) => createFeedItem(source.id, source.name, item))
    );

    return items
        .sort(
            (left, right) =>
                (right.publishedAt ?? 0) - (left.publishedAt ?? 0) ||
                left.title.localeCompare(right.title) ||
                left.id.localeCompare(right.id)
        )
        .slice(0, maxItems);
}

function createFeedItem(sourceId: string, sourceName: string | undefined, item: NewsItem): FeedItem {
    const publishedAt = parseSourceItemsSince(item.pubDate ?? item.extra?.date);
    const contentText = getItemContentText(sourceName, item);

    return {
        id: `${sourceId}:${String(item.id ?? item.url)}`,
        url: item.url,
        title: item.title,
        contentText,
        sourceId,
        sourceName,
        publishedAt,
    };
}

function getItemContentText(sourceName: string | undefined, item: NewsItem) {
    const extraInfo = typeof item.extra?.info === "string" ? item.extra.info : undefined;
    return item.extra?.hover ?? extraInfo ?? sourceName;
}

function formatIsoDate(value: number | undefined) {
    return value ? new Date(value).toISOString() : undefined;
}

function escapeXml(value: string) {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}
