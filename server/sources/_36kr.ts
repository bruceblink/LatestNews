import type { NewsItem } from "@shared/types";

import { load } from "cheerio";
import { myFetch } from "#/utils/fetch";
import { defineSource } from "#/utils/source";
import { parseRelativeDate } from "#/utils/date";

const quick = defineSource(async () => {
    const baseURL = "https://www.36kr.com";
    const url = `${baseURL}/newsflashes`;
    const response = (await myFetch(url)) as any;
    const $ = load(response);
    const news: NewsItem[] = [];
    const $items = $(".newsflash-item");
    $items.each((_, el) => {
        const $el = $(el);
        const $a = $el.find("a.item-title");
        const href = $a.attr("href");
        const title = $a.text();
        const relativeDate = $el.find(".time").text();
        if (href && title && relativeDate) {
            news.push({
                url: `${baseURL}${href}`,
                title,
                id: href,
                extra: {
                    date: parseRelativeDate(relativeDate, "Asia/Shanghai").valueOf(),
                },
            });
        }
    });

    return news;
});

export default defineSource({
    "36kr": quick,
    "36kr-quick": quick,
});
