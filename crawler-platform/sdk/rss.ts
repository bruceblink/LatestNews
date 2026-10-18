import { XMLParser } from "fast-xml-parser";

import { CrawlerPlatformError } from "../core/errors";

import type { CrawlerContext } from "./types";

type XmlRecord = Record<string, unknown>;

export interface CrawlerRssItem {
    guid?: string;
    title: string;
    url: string;
    publishedAt?: string;
}

const parser = new XMLParser({
    attributeNamePrefix: "",
    ignoreAttributes: false,
    parseTagValue: false,
    textNodeName: "$text",
    trimValues: true,
});

/** Fetch and parse an RSS or Atom feed through the host's permission-checked HTTP bridge. */
export async function readRssItems(context: CrawlerContext, url: string): Promise<CrawlerRssItem[]> {
    const response = await context.http.request({
        url,
        headers: { accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" },
    });
    if (response.status < 200 || response.status >= 300) {
        throw new CrawlerPlatformError("HTTP_FAILED", `Feed returned status ${response.status}.`);
    }
    return parseRssItems(response.body);
}

/** Parse common RSS and Atom item fields without coupling plugins to LatestNews server modules. */
export function parseRssItems(xml: string): CrawlerRssItem[] {
    const document = asRecord(parser.parse(xml));
    const rss = asRecord(first(document?.rss));
    const channel = asRecord(first(rss?.channel)) ?? asRecord(first(document?.feed));
    if (!channel)
        throw new CrawlerPlatformError("INVALID_PLUGIN", "Feed does not contain an RSS channel or Atom feed.");

    const entries = asArray(channel.item ?? channel.entry).filter(
        (entry): entry is XmlRecord => asRecord(entry) !== undefined
    );
    return entries
        .map((entry) => {
            const rawLink = first(entry.link);
            const linkRecord = asRecord(rawLink);
            const url = typeof linkRecord?.href === "string" ? linkRecord.href : getText(rawLink);
            const title = getText(entry.title);
            const guid = getOptionalText(entry.guid) ?? getOptionalText(entry.id);
            const publishedAt =
                getOptionalText(entry.updated) ?? getOptionalText(entry.pubDate) ?? getOptionalText(entry.created);
            return {
                ...(guid ? { guid } : {}),
                title,
                url,
                ...(publishedAt ? { publishedAt } : {}),
            };
        })
        .filter((entry) => entry.title.length > 0 && entry.url.length > 0);
}

function asRecord(value: unknown): XmlRecord | undefined {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as XmlRecord) : undefined;
}

function asArray(value: unknown): unknown[] {
    if (value === undefined || value === null) return [];
    return Array.isArray(value) ? value : [value];
}

function first(value: unknown) {
    return Array.isArray(value) ? value[0] : value;
}

function getOptionalText(value: unknown): string | undefined {
    const text = getText(value);
    return text.length > 0 ? text : undefined;
}

function getText(value: unknown): string {
    const firstValue = first(value);
    if (typeof firstValue === "string" || typeof firstValue === "number" || typeof firstValue === "boolean") {
        return String(firstValue).trim();
    }
    const record = asRecord(firstValue);
    const text = record?.$text;
    return typeof text === "string" || typeof text === "number" || typeof text === "boolean" ? String(text).trim() : "";
}
