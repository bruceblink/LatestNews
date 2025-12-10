import type { NewsItem } from "@shared/types";

import * as cheerio from "cheerio";

import { myFetch } from "../utils/fetch";
import { parseRelativeDate } from "../utils/date";
import { defineSource, generateUrlHashId } from "../utils/source";

export default defineSource(async () => {
    const baseURL = "https://www.gelonghui.com";
    const html: any = await myFetch("https://www.gelonghui.com/news/");
    const $ = cheerio.load(html);
    const $main = $(".article-content");
    const news: NewsItem[] = [];
    for (const el of $main) {
        const a = $(el).find(".detail-right>a");
        // https://www.kzaobao.com/shiju/20241002/170659.html
        const url = a.attr("href");
        const title = a.find("h2").text();
        const info = $(el).find(".time > span:nth-child(1)").text();
        // 第三个 p
        const relatieveTime = $(el).find(".time > span:nth-child(3)").text();
        if (url && title && relatieveTime) {
            const fullUrl = url.startsWith("http") ? url : `${baseURL}${url}`;
            const hashId = await generateUrlHashId(fullUrl);

            news.push({
                id: hashId,
                title,
                url: fullUrl,
                extra: {
                    date: parseRelativeDate(relatieveTime, "Asia/Shanghai").valueOf(),
                    info,
                },
            });
        }
    }
    return news;
});
