import type { NewsItem } from "@shared/types";

import * as cheerio from "cheerio";

import { myFetch } from "../utils/fetch";
import { defineSource, generateUrlHashId } from "../utils/source";

const trending = defineSource(async () => {
    const baseURL = "https://github.com";
    const html: any = await myFetch("https://github.com/trending?spoken_language_code=");
    const $ = cheerio.load(html);
    const $main = $("main .Box div[data-hpc] > article");

    const newsTasks: Promise<NewsItem | null>[] = [];
    for (const el of $main) {
        const a = $(el).find(">h2 a");
        const title = a.text().replace(/\n+/g, "").trim();
        const url = a.attr("href");
        const star = $(el).find("[href$=stargazers]").text().replace(/\s+/g, "").trim();
        const desc = $(el).find(">p").text().replace(/\n+/g, "").trim();

        if (!url || !title) continue;
        const fullUrl = url.startsWith("http") ? url : `${baseURL}${url}`;

        newsTasks.push(
            (async () => {
                const hashId = await generateUrlHashId(fullUrl);

                return {
                    id: hashId,
                    title,
                    url: fullUrl,
                    extra: {
                        info: `✰ ${star}`,
                        hover: desc,
                    },
                } as NewsItem;
            })()
        );
    }
    const results = await Promise.all(newsTasks);
    return results as NewsItem[];
});

export default defineSource({
    github: trending,
    "github-trending-today": trending,
});
