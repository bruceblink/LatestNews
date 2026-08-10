import type { NewsItem } from "@shared/types";

import * as cheerio from "cheerio";
import { defineSource, generateUrlHashId } from "#/utils/source";

import { myFetch } from "../utils/fetch";

export const SPUTNIK_TIMELINE_URL = "https://sputniknews.cn/services/widget/lenta/";

/** Fetches and parses Sputnik's timeline without routing back through LatestNews. */
export async function fetchSputnikNewsItems(fetcher: typeof myFetch = myFetch): Promise<NewsItem[]> {
    const response = await fetcher<string>(SPUTNIK_TIMELINE_URL);
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
}

// Fetch the upstream directly. Pointing this source at LatestNews itself creates a recursive request on Cloudflare.
export default defineSource(fetchSputnikNewsItems);
