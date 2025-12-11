import type { NewsItem } from "@shared/types";

import iconv from "iconv-lite";
import * as cheerio from "cheerio";
import { Buffer } from "node:buffer";

import { myFetch } from "../utils/fetch";
import { parseRelativeDate } from "../utils/date";
import { defineSource, generateUrlHashId } from "../utils/source";

export default defineSource(async () => {
    const response: ArrayBuffer = await myFetch("https://www.zaochenbao.com/realtime/", {
        responseType: "arrayBuffer",
    });
    const base = "https://www.zaochenbao.com";
    const utf8String = iconv.decode(Buffer.from(response), "gb2312");
    const $ = cheerio.load(utf8String);
    const $main = $("div.list-block>a.item");
    const news: Promise<NewsItem>[] = [];
    for (const el of $main) {
        const a = $(el);
        const url = a.attr("href");
        const title = a.find(".eps")?.text();
        const date = a.find(".pdt10")?.text().replace(/-\s/g, " ");

        if (!url || !title || !date) continue;

        news.push(
            (async () => {
                const fullUrl = `${base}${url}`;
                const hashId = await generateUrlHashId(fullUrl);

                return {
                    id: hashId,
                    title,
                    url: fullUrl,
                    pubDate: parseRelativeDate(date, "Asia/Shanghai").valueOf(),
                } as NewsItem;
            })()
        );
    }
    const results = await Promise.all(news);
    return results.sort((m, n) => (n?.pubDate! > m?.pubDate! ? 1 : -1));
});
