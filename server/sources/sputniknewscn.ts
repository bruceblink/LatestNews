import type { NewsItem } from "@shared/types";

import * as cheerio from "cheerio";
import { HOME_PAGE } from "@shared/consts.ts";
import { proxySource, defineSource, generateUrlHashId } from "#/utils/source";

import { myFetch } from "../utils/fetch";

const source = defineSource(async () => {
    const response: any = await myFetch("https://sputniknews.cn/services/widget/lenta/");
    const $ = cheerio.load(response);
    const $items = $(".lenta__item");
    const news: Promise<NewsItem | null>[] = [];
    for (const el of $items) {
        const $el = $(el);
        const $a = $el.find("a");
        const url = $a.attr("href");
        const title = $a.find(".lenta__item-text").text();
        const date = $a.find(".lenta__item-date").attr("data-unixtime");

        if (!url || !title || !date) continue;

        news.push(
            (async () => {
                const fullUrl = `https://sputniknews.cn${url}`;
                const hashId = await generateUrlHashId(fullUrl);

                return {
                    id: hashId,
                    title,
                    url: fullUrl,
                    extra: {
                        date: new Date(Number(`${date}000`)).getTime(),
                    },
                } as NewsItem;
            })()
        );
    }
    const results = await Promise.all(news);
    return results as NewsItem[];
});

export default proxySource(`${HOME_PAGE}/api/s?id=sputniknewscn&latest=`, source);
