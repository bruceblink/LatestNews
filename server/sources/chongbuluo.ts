import type { NewsItem } from "@shared/types";

import * as cheerio from "cheerio";
import { myFetch } from "#/utils/fetch";
import { defineSource, defineRSSSource, generateUrlHashId } from "#/utils/source";

const hot = defineSource(async () => {
    const baseUrl = "https://www.chongbuluo.com/";
    const html: string = await myFetch(`${baseUrl}forum.php?mod=guide&view=hot`);
    const $ = cheerio.load(html);
    const news: NewsItem[] = [];

    const $items = $(".bmw table tr");

    // 使用 for...of 循环替代 .each()，以便支持 await
    for (const elem of $items) {
        const xst = $(elem).find(".common .xst").text();
        const url = $(elem).find(".common a").attr("href");

        if (url && xst) {
            const fullUrl = url.startsWith("http") ? url : `${baseUrl}${url}`;
            const hashId = await generateUrlHashId(fullUrl);

            news.push({
                id: hashId,
                url: fullUrl,
                title: xst,
                extra: {
                    hover: xst,
                },
            });
        }
    }

    return news;
});

const latest = defineRSSSource("https://www.chongbuluo.com/forum.php?mod=rss&view=newthread");

export default defineSource({
    "chongbuluo-hot": hot,
    "chongbuluo-latest": latest,
});
