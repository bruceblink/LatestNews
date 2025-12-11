import type { NewsItem } from "@shared/types";

import * as cheerio from "cheerio";

import { myFetch } from "../utils/fetch";
import { defineSource, generateUrlHashId } from "../utils/source";

export default defineSource(async () => {
    const baseURL = "https://post.smzdm.com/hot_1/";
    const html: any = await myFetch(baseURL);
    const $ = cheerio.load(html);
    const $main = $("#feed-main-list .z-feed-title");
    const news: Promise<NewsItem | null>[] = [];
    for (const el of $main) {
        const a = $(el).find("a");
        const url = a.attr("href")!;
        const title = a.text();
        news.push(
            (async () => {
                const hashId = await generateUrlHashId(url);

                return {
                    id: hashId,
                    url,
                    title,
                } as NewsItem;
            })()
        );
    }
    const results = await Promise.all(news);
    return results as NewsItem[];
});
