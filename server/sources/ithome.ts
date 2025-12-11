import type { NewsItem } from "@shared/types";

import * as cheerio from "cheerio";

import { myFetch } from "../utils/fetch";
import { parseRelativeDate } from "../utils/date";
import { defineSource, generateUrlHashId } from "../utils/source";

export default defineSource(async () => {
    const response: any = await myFetch("https://www.ithome.com/list/");
    const $ = cheerio.load(response);
    const $main = $("#list > div.fl > ul > li");
    const newsTasks: Promise<NewsItem>[] = [];
    for (const el of $main) {
        const $el = $(el);
        const $a = $el.find("a.t");
        const url = $a.attr("href");
        const title = $a.text();
        const date = $(el).find("i").text();

        if (!url || !title || !date) continue;
        const isAd = url?.includes("lapin") || ["神券", "优惠", "补贴", "京东"].find((k) => title.includes(k));

        if (isAd) continue;
        newsTasks.push(
            (async () => {
                const hashId = await generateUrlHashId(url);

                return {
                    id: hashId,
                    title,
                    url,
                    pubDate: parseRelativeDate(date, "Asia/Shanghai").valueOf(),
                } as NewsItem;
            })()
        );
    }
    const results = await Promise.all(newsTasks);
    return results.sort((m, n) => (n?.pubDate! > m?.pubDate! ? 1 : -1));
});
