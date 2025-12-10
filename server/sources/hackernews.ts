import type { NewsItem } from "@shared/types";

import * as cheerio from "cheerio";

import { myFetch } from "../utils/fetch";
import { defineSource, generateUrlHashId } from "../utils/source";

export default defineSource(async () => {
    const baseURL = "https://news.ycombinator.com";
    const html: any = await myFetch(baseURL);
    const $ = cheerio.load(html);
    const $main = $(".athing");

    const newsTasks: Promise<NewsItem | null>[] = [];

    for (const el of $main) {
        const a = $(el).find(".titleline a").first();
        // const url = a.attr("href")
        const title = a.text();
        const id = $(el).attr("id");
        const score = $(`#score_${id}`).text();
        const url = `${baseURL}/item?id=${id}`;

        if (!url || !id || !title) continue;

        newsTasks.push(
            (async () => {
                const hashId = await generateUrlHashId(url);

                return {
                    id: hashId,
                    title,
                    url,
                    extra: {
                        info: score,
                    },
                } as NewsItem;
            })()
        );
    }
    const results = await Promise.all(newsTasks);
    return results as NewsItem[];
});
