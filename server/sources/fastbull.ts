import type { NewsItem } from "@shared/types";

import * as cheerio from "cheerio";

import { myFetch } from "../utils/fetch";
import { defineSource, generateUrlHashId } from "../utils/source";

const express = defineSource(async () => {
    const baseURL = "https://www.fastbull.com";
    const html: any = await myFetch(`${baseURL}/cn/express-news`);
    const $ = cheerio.load(html);
    const $main = $(".news-list");
    const news: NewsItem[] = [];
    for (const el of $main) {
        const a = $(el).find(".title_name");
        const url = a.attr("href");
        const titleText = a.text();
        const title = titleText.match(/【(.+)】/)?.[1] ?? titleText;
        const date = $(el).attr("data-date");
        if (url && title && date) {
            const fullUrl = url.startsWith("http") ? url : `${baseURL}${url}`;
            const hashId = await generateUrlHashId(fullUrl);

            news.push({
                id: hashId,
                title: title.length < 4 ? titleText : title,
                url: fullUrl,
                pubDate: Number(date),
            });
        }
    }
    return news;
});

const news = defineSource(async () => {
    const baseURL = "https://www.fastbull.com";
    const html: any = await myFetch(`${baseURL}/cn/news`);
    const $ = cheerio.load(html);
    const $main = $(".trending_type");
    const newsItems: NewsItem[] = [];
    for (const el of $main) {
        const a = $(el);
        const url = a.attr("href");
        const title = a.find(".title").text();
        const date = a.find("[data-date]").attr("data-date");
        if (url && title && date) {
            const fullUrl = url.startsWith("http") ? url : `${baseURL}${url}`;
            const hashId = await generateUrlHashId(fullUrl);

            newsItems.push({
                id: hashId,
                title,
                url: fullUrl,
                pubDate: Number(date),
            });
        }
    }
    return newsItems;
});

export default defineSource({
    fastbull: express,
    "fastbull-express": express,
    "fastbull-news": news,
});
