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

    // 1. 构造所有Promise任务
    const tasks: Promise<NewsItem | null>[] = [];

    for (const el of $main) {
        const a = $(el).find(".detail-right>a");
        const url = a.attr("href");
        const title = a.find("h2").text();
        const info = $(el).find(".time > span:nth-child(1)").text();
        const relatieveTime = $(el).find(".time > span:nth-child(3)").text();

        if (!url || !title || !relatieveTime) continue;

        const fullUrl = url.startsWith("http") ? url : `${baseURL}${url}`;

        // 2. 推入 Promise 任务，让 hash 生成并发
        tasks.push(
            (async () => {
                const hashId = await generateUrlHashId(fullUrl);

                return {
                    id: hashId,
                    title,
                    url: fullUrl,
                    extra: {
                        date: parseRelativeDate(relatieveTime, "Asia/Shanghai").valueOf(),
                        info,
                    },
                } as NewsItem;
            })()
        );
    }

    // 3. 使用 Promise.all 并发执行所有任务
    const results = await Promise.all(tasks);

    // 4. 过滤 null（理论上不会有）
    return results.filter(Boolean) as NewsItem[];
});
