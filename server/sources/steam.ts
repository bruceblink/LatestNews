import type { NewsItem } from "@shared/types.ts";

import * as cheerio from "cheerio";

import { myFetch } from "../utils/fetch.ts";
import { defineSource, generateUrlHashId } from "../utils/source.ts";

export default defineSource(async () => {
    const response: any = await myFetch("https://store.steampowered.com/stats/stats/");
    const $ = cheerio.load(response);
    const $rows = $("#detailStats tr.player_count_row");
    const news: Promise<NewsItem | null>[] = [];

    for (const el of $rows) {
        const $el = $(el);
        const $a = $el.find("a.gameLink");
        const url = $a.attr("href");
        const gameName = $a.text().trim();
        const currentPlayers = $el.find("td:first-child .currentServers").text().trim();

        if (!url || !gameName || !currentPlayers) continue;

        news.push(
            (async () => {
                const hashId = await generateUrlHashId(url);
                const title = gameName;
                return {
                    id: hashId,
                    title,
                    url,
                    pubDate: Date.now(),
                    extra: {
                        info: currentPlayers,
                    },
                } as NewsItem;
            })()
        );
    }

    const results = await Promise.all(news);
    return results as NewsItem[];
});
