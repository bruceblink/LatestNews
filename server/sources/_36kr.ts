import type { NewsItem } from "@shared/types";

import { load } from "cheerio";
import { myFetch } from "#/utils/fetch";
import { parseRelativeDate } from "#/utils/date";
import { defineSource, generateUrlHashId } from "#/utils/source";

const quick = defineSource(async () => {
    const baseURL = "https://www.36kr.com";
    const url = `${baseURL}/newsflashes`;
    const response = (await myFetch(url)) as any;
    const $ = load(response);
    const news: NewsItem[] = [];
    const $items = $(".newsflash-item");

    for (const el of $items) {
        const $el = $(el);
        const $a = $el.find("a.item-title");
        const href = $a.attr("href");
        const title = $a.text();
        const relativeDate = $el.find(".time").text();

        if (href && title && relativeDate) {
            const fullUrl = href.startsWith("http") ? href : `${baseURL}${href}`;
            const hashId = await generateUrlHashId(fullUrl);

            news.push({
                id: hashId,
                title,
                url: fullUrl,
                extra: {
                    date: parseRelativeDate(relativeDate, "Asia/Shanghai").valueOf(),
                },
            });
        }
    }

    return news;
});

interface Res {
    msg: string;
    name: string;
    title: string;
    type: string;
    update_time: string;
    total: string;
    data: Item[];
}

interface Item {
    id: number;
    timestamp: string;
    title: string;
    statRead: number;
    statCollect: number;
    statPraise: number;
    statFormat: string;
    author: string;
    head_pic: string;
    url: string;
    mobileUrl: string;
}

const renqi = defineSource(async () => {
    const baseURL = "http://api.cc1990.cc/api/hotlist/36kr?type=hot";

    const res: Res = await myFetch(baseURL, {
        headers: {
            "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
            Referer: "https://36kr.com",
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
        },
    });

    return await Promise.all(
        res.data.map(async (news) => {
            const hashId = await generateUrlHashId(news.url);
            const parts = [
                news.author,
                news.statPraise ? `${news.statPraise}点赞` : null,
                news.statCollect ? `${news.statCollect}收藏` : null,
            ].filter(Boolean);
            return {
                id: hashId,
                title: news.title,
                url: news.url,
                pubDate: news.timestamp,
                extra: {
                    info: parts.join("  |  "),
                    hover: news.head_pic,
                },
            };
        })
    );
});

export default defineSource({
    "36kr": quick,
    "36kr-quick": quick,
    "36kr-renqi": renqi,
});
