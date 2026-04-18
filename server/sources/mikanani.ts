import type { NewsItem } from "@shared/types";

import dayjs from "dayjs/esm";
import { load } from "cheerio";
import { myFetch } from "#/utils/fetch";
import { defineSource } from "#/utils/source";

/**
 * 蜜柑计划 - 今日更新动漫
 * 抓取 mikanani.me 首页，过滤出今日更新条目
 */
const today = defineSource(async () => {
    const url = "https://mikanani.me/";
    const html = await myFetch<string>(url, {
        headers: { Referer: "https://mikanani.me/" },
        parseResponse: (txt) => txt,
    });

    const $ = load(html);
    const todayDate = dayjs().format("YYYY/MM/DD");

    const items: NewsItem[] = [];

    $("li").each((_, el) => {
        const li = $(el);

        // 必须包含集数节点
        if (!li.find("div.num-node.text-center").length) return;

        // date-text 必须包含今天日期
        const dateTextEl = li.find("div.date-text").first();
        const dateText = dateTextEl.text().trim();
        if (!dateText.includes(todayDate)) return;

        const a = li.find("a.an-text").first();
        const title = a.attr("title")?.trim() ?? "";
        const href = a.attr("href") ?? "";
        if (!title || !href) return;

        const detailUrl = href.startsWith("http") ? href : `https://mikanani.me${href}`;

        const imgSrc = li.find("span.js-expand_bangumi").attr("data-src") ?? "";
        const imageUrl = imgSrc.startsWith("http") ? imgSrc : imgSrc ? `https://mikanani.me${imgSrc}` : "";

        items.push({
            id: detailUrl,
            title,
            url: detailUrl,
            pubDate: dateText,
            extra: {
                info: dateText,
                icon: imageUrl || false,
            },
        });
    });

    return items;
});

export default defineSource({
    mikanani: today,
});
