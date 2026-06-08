import { XMLParser } from "fast-xml-parser";

import { myFetch } from "./fetch";

import type { RSSInfo, RSSItem } from "../types";

type XmlRecord = Record<string, unknown>;

const EXTRA_ITEM_KEYS = [
    "content:encoded",
    "podcast:transcript",
    "itunes:summary",
    "itunes:author",
    "itunes:explicit",
    "itunes:duration",
    "itunes:season",
    "itunes:episode",
    "itunes:episodeType",
    "itunes:image",
] as const;

function isRecord(value: unknown): value is XmlRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstValue(value: unknown): unknown {
    return Array.isArray(value) ? value[0] : value;
}

function firstRecord(value: unknown): XmlRecord | undefined {
    const first = firstValue(value);
    return isRecord(first) ? first : undefined;
}

function asArray(value: unknown): unknown[] {
    if (value === undefined || value === null) return [];
    return Array.isArray(value) ? value : [value];
}

function textOf(value: unknown): string {
    const first = firstValue(value);
    if (typeof first === "string" || typeof first === "number" || typeof first === "boolean") return String(first);
    if (!isRecord(first)) return "";

    const text = first.$text;
    return typeof text === "string" || typeof text === "number" || typeof text === "boolean" ? String(text) : "";
}

function optionalTextOf(value: unknown): string | undefined {
    const text = textOf(value);
    return text || undefined;
}

function linkOf(value: unknown): string {
    const first = firstValue(value);
    if (isRecord(first) && typeof first.href === "string") return first.href;
    return textOf(first);
}

function imageOf(channel: XmlRecord): string {
    const image = firstRecord(channel.image);
    if (image) {
        const imageUrl = textOf(image.url);
        if (imageUrl) return imageUrl;
    }

    const itunesImage = firstRecord(channel["itunes:image"]);
    return typeof itunesImage?.href === "string" ? itunesImage.href : "";
}

function authorOf(item: XmlRecord): string | undefined {
    const author = firstRecord(item.author);
    if (author) return optionalTextOf(author.name);
    return optionalTextOf(item["dc:creator"]);
}

function buildItem(item: XmlRecord): RSSItem {
    const media: Record<string, unknown> = {};
    const enclosures = asArray(item.enclosure);

    const rssItem: RSSItem = {
        id: optionalTextOf(item.guid) ?? optionalTextOf(item.id),
        title: textOf(item.title),
        description: optionalTextOf(item.summary) ?? textOf(item.description),
        link: linkOf(item.link),
        author: authorOf(item),
        created: optionalTextOf(item.updated) ?? optionalTextOf(item.pubDate) ?? optionalTextOf(item.created),
        category: asArray(item.category),
        content: optionalTextOf(item.content) ?? optionalTextOf(item["content:encoded"]),
        enclosures,
    };

    for (const key of EXTRA_ITEM_KEYS) {
        const value = item[key];
        if (value !== undefined) rssItem[key.replace(":", "_")] = value;
    }

    const mediaThumbnail = item["media:thumbnail"];
    if (mediaThumbnail !== undefined) {
        media.thumbnail = mediaThumbnail;
        enclosures.push(mediaThumbnail);
    }

    const mediaContent = item["media:content"];
    if (mediaContent !== undefined) {
        media.content = mediaContent;
        enclosures.push(mediaContent);
    }

    const mediaGroup = firstRecord(item["media:group"]);
    if (mediaGroup) {
        const mediaTitle = optionalTextOf(mediaGroup["media:title"]);
        const mediaDescription = optionalTextOf(mediaGroup["media:description"]);
        if (mediaTitle) rssItem.title = mediaTitle;
        if (mediaDescription) rssItem.description = mediaDescription;

        const groupThumbnail = firstRecord(mediaGroup["media:thumbnail"]);
        if (typeof groupThumbnail?.url === "string") enclosures.push(groupThumbnail.url);

        const groupContent = mediaGroup["media:content"];
        if (groupContent !== undefined) enclosures.push(groupContent);
    }

    rssItem.media = media;
    return rssItem;
}

export function parseRssXml(data: string): RSSInfo | undefined {
    const xml = new XMLParser({
        attributeNamePrefix: "",
        textNodeName: "$text",
        ignoreAttributes: false,
    });

    const result = xml.parse(data) as unknown;
    if (!isRecord(result)) return undefined;

    const rssNode = firstRecord(result.rss);
    const channel = firstRecord(rssNode?.channel) ?? firstRecord(result.feed);
    if (!channel) return undefined;

    return {
        title: textOf(channel.title),
        description: textOf(channel.description),
        link: linkOf(channel.link),
        image: imageOf(channel),
        category: asArray(channel.category),
        updatedTime: optionalTextOf(channel.lastBuildDate) ?? optionalTextOf(channel.updated) ?? "",
        items: asArray(channel.item ?? channel.entry)
            .filter(isRecord)
            .map((item) => buildItem(item)),
    };
}

export async function rss2json(url: string): Promise<RSSInfo | undefined> {
    if (!/^https?:\/\/[^\s$.?#].\S*/i.test(url)) return undefined;

    const data = await myFetch<string>(url);
    return parseRssXml(data);
}
