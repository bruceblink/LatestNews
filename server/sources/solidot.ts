import type { NewsItem } from "@shared/types";

import * as cheerio from "cheerio";

import { myFetch } from "../utils/fetch";
import { parseRelativeDate } from "../utils/date";
import { defineSource, generateUrlHashId } from "../utils/source";

export default defineSource(async () => {
    const baseURL = "https://www.solidot.org";
    const html: any = await myFetch(baseURL);
    const $ = cheerio.load(html);
    const $main = $(".block_m");
    const news: Promise<NewsItem | null>[] = [];
    for (const el of $main) {
        const a = $(el).find(".bg_htit a").last();
        const url = a.attr("href");
        const title = a.text();
        const date_raw = $(el)
            .find(".talk_time")
            .text()
            .match(/发表于(.*?分)/)?.[1];
        const date = date_raw
            ?.replace(/[年月]/g, "-")
            .replace("时", ":")
            .replace(/[分日]/g, "");

        if (!url || !title || !date) continue;

        news.push(
            (async () => {
                const fullUrl = `${baseURL}${url}`;
                const hashId = await generateUrlHashId(fullUrl);

                return {
                    id: hashId,
                    title,
                    url: fullUrl,
                    pubDate: parseRelativeDate(date, "Asia/Shanghai").valueOf(),
                } as NewsItem;
            })()
        );
    }
    const results = await Promise.all(news);
    return results as NewsItem[];
});
