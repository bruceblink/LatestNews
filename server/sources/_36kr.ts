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
    code: number;
    data: {
        hotRankList: Item[];
    };
}

interface Item {
    itemId: number;
    itemType: number;
    templateMaterial: {
        itemId: number;
        templateType: number;
        widgetImage: string;
        widgetTitle: string;
        publishTime: number;
        authorName: string;
        statRead: number;
        statCollect: number;
        statPraise: number;
        statFormat: string;
    };
    route: string;
    siteId: number;
    publishTime: number;
}

const renqi = defineSource(async () => {
    const baseURL = "https://gateway.36kr.com/api/mis/nav/home/nav/rank/hot?size=20";

    const res: Res = await myFetch(baseURL, {
        method: "POST",
        headers: {
            "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
            Referer: "https://36kr.com",
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
        },
        body: {
            partner_id: "web",
            param: {
                siteId: 1,
                platformId: 3,
            },
        },
    });

    return await Promise.all(
        res.data.hotRankList.map(async (news) => {
            const fullUrl = `https://36kr.com/p/${news.itemId}`;
            const hashId = await generateUrlHashId(fullUrl);
            const parts = [
                news.templateMaterial.authorName,
                news.templateMaterial?.statRead ? `${news.templateMaterial?.statRead}阅读` : null,
                news.templateMaterial?.statPraise ? `${news.templateMaterial?.statPraise}点赞` : null,
                news.templateMaterial?.statCollect ? `${news.templateMaterial?.statCollect}收藏` : null,
            ].filter(Boolean);
            return {
                id: hashId,
                title: news.templateMaterial.widgetTitle,
                url: fullUrl,
                pubDate: news.templateMaterial.publishTime,
                extra: {
                    info: parts.join("  |  "),
                    hover: news.templateMaterial.widgetImage,
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
