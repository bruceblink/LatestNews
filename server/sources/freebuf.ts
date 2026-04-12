import type { NewsItem } from "@shared/types";

import * as cheerio from "cheerio";

import { myFetch } from "../utils/fetch";
import { defineSource, generateUrlHashId } from "../utils/source";

const BASE_URL = "https://www.freebuf.com";

function normalizeUrl(url: string) {
    const cleaned = url.replace(/\\\//g, "/").trim();
    return cleaned.startsWith("http") ? cleaned : `${BASE_URL}${cleaned}`;
}

function normalizeTitle(title: string) {
    return title
        .replace(/\\u003C[^>]*\\u003E/g, "")
        .replace(/\\\"/g, '"')
        .replace(/\s+/g, " ")
        .trim();
}

function extractFromLegacyDom(html: string) {
    const $ = cheerio.load(html);
    const pairs: Array<{ title: string; url: string }> = [];
    const seen = new Set<string>();

    $(".article-item").each((_, articleElement) => {
        const $article = $(articleElement);
        const title = normalizeTitle($article.find(".title-left .title").first().text());
        const href = $article.find(".title-left .title").first().parent().attr("href") || "";
        const url = normalizeUrl(href);

        if (!title || !url || seen.has(url)) return;
        seen.add(url);
        pairs.push({ title, url });
    });

    return pairs;
}

function extractFromNuxtPayload(html: string) {
    const patterns = [
        /post_title:"([^"]{6,})"[\s\S]{0,1200}?url:"((?:\/articles|\/news)\/[^\"]+?\.html)"/g,
        /title:"([^"]{6,})"[\s\S]{0,1200}?url:"((?:\/articles|\/news)\/[^\"]+?\.html)"/g,
    ];

    const pairs: Array<{ title: string; url: string }> = [];
    const seen = new Set<string>();

    for (const pattern of patterns) {
        for (const match of html.matchAll(pattern)) {
            const title = normalizeTitle(match[1] ?? "");
            const url = normalizeUrl(match[2] ?? "");
            if (!title || !url || seen.has(url)) continue;
            seen.add(url);
            pairs.push({ title, url });
        }
    }

    return pairs;
}

export default defineSource(async () => {
    const html = await myFetch<string>(BASE_URL, {
        headers: {
            "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
            Referer: `${BASE_URL}/`,
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
    });

    const articles = extractFromLegacyDom(html);
    const fallbackArticles = articles.length ? articles : extractFromNuxtPayload(html);
    const uniqueArticles = fallbackArticles.slice(0, 30);

    if (!uniqueArticles.length) {
        throw new Error("Cannot extract freebuf articles from homepage payload");
    }

    const newsTasks: Promise<NewsItem>[] = uniqueArticles.map(async (item) => {
        const hashId = await generateUrlHashId(item.url);
        return {
            id: hashId,
            title: item.title,
            url: item.url,
        } as NewsItem;
    });

    return Promise.all(newsTasks);
});
