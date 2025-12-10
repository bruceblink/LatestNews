import type { NewsItem } from "@shared/types";

import * as cheerio from "cheerio";

import { myFetch } from "../utils/fetch";
import { defineSource, generateUrlHashId } from "../utils/source";

const express = defineSource(async () => {
    const baseURL = "https://www.fastbull.com";
    const html: any = await myFetch(`${baseURL}/cn/express-news`);
    const $ = cheerio.load(html);
    const $main = $(".news-list");
    // 1. 构造所有Promise任务
    const tasks: Promise<NewsItem | null>[] = [];
    for (const el of $main) {
        const a = $(el).find(".title_name");
        const url = a.attr("href");
        const titleText = a.text();
        const title = titleText.match(/【(.+)】/)?.[1] ?? titleText;
        const date = $(el).attr("data-date");

        if (!url || !title || !date) continue;
        const fullUrl = url.startsWith("http") ? url : `${baseURL}${url}`;

        // 2. 添加所有Promise任务
        tasks.push(
            (async () => {
                const hashId = await generateUrlHashId(fullUrl);

                return {
                    id: hashId,
                    title: title.length < 4 ? titleText : title,
                    url: fullUrl,
                    pubDate: Number(date),
                } as NewsItem;
            })()
        );
    }

    // 3. 使用 Promise.all 并发执行所有任务
    const results = await Promise.all(tasks);

    return results as NewsItem[];
});

const news = defineSource(async () => {
    const baseURL = "https://www.fastbull.com";
    const html: any = await myFetch(`${baseURL}/cn/news`);
    const $ = cheerio.load(html);
    const $main = $(".trending_type");
    // 1. 构造所有Promise任务
    const tasks: Promise<NewsItem | null>[] = [];
    for (const el of $main) {
        const a = $(el);
        const url = a.attr("href");
        const title = a.find(".title").text();
        const date = a.find("[data-date]").attr("data-date");

        if (!url || !title || !date) continue;
        const fullUrl = url.startsWith("http") ? url : `${baseURL}${url}`;

        // 2. 添加所有Promise任务
        tasks.push(
            (async () => {
                const hashId = await generateUrlHashId(fullUrl);

                return {
                    id: hashId,
                    title,
                    url: fullUrl,
                    pubDate: Number(date),
                } as NewsItem;
            })()
        );
    }
    // 3. 使用 Promise.all 并发执行所有任务
    const results = await Promise.all(tasks);
    return results as NewsItem[];
});

export default defineSource({
    fastbull: express,
    "fastbull-express": express,
    "fastbull-news": news,
});
