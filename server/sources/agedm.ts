import type { NewsItem } from "@shared/types";

import { load } from "cheerio";
import { myFetch } from "#/utils/fetch";
import { defineSource } from "#/utils/source";

/**
 * 将 agedm detail 页 URL 规范化为 play 页 URL，并拼接集数
 * 例: http://www.agedm.vip/detail/20250001/ -> https://www.agedm.vip/play/20250001/1/12
 */
function buildAgedmPlayUrl(rawHref: string, episodeNum: string): string {
    const normalized = rawHref
        .replace(/^http:/, "https:")
        .replace("/detail/", "/play/")
        .replace(/\/$/, "");
    return episodeNum ? `${normalized}/1/${episodeNum}` : normalized;
}

/**
 * AGE动漫 - 今日更新动漫
 * 抓取 agedm.vip 首页"今天"区块
 */
const today = defineSource(async () => {
    const url = "https://www.agedm.vip/";
    const html = await myFetch<string>(url, {
        headers: { Referer: "https://www.agedm.vip/" },
        parseResponse: (txt) => txt,
    });

    const $ = load(html);

    // 找到按钮文本以"今天"开头的最近更新区块
    const todayBox = $("div.video_list_box.recent_update")
        .filter((_, el) => {
            return $(el)
                .find("button.btn-danger")
                .toArray()
                .some((btn) => $(btn).text().trim().startsWith("今天"));
        })
        .first();

    if (!todayBox.length) return [];

    const items: NewsItem[] = [];

    todayBox.find("div.row > div.col").each((_, el) => {
        const col = $(el);

        const imgEl = col.find("img.video_thumbs").first();
        const imageUrl = imgEl.attr("data-original") || imgEl.attr("src") || "";

        // updateInfo 格式如 "更新至12集" / "第12集" / "12"
        const updateInfo = col.find("span.video_item--info").first().text().trim();
        const updateCount = updateInfo.match(/\d+/)?.[0] ?? "";

        const a = col.find("div.video_item-title a").first();
        const title = a.text().trim();
        const href = a.attr("href") ?? "";
        if (!title || !href) return;

        const detailUrl = buildAgedmPlayUrl(href, updateCount);

        items.push({
            id: detailUrl,
            title,
            url: detailUrl,
            extra: {
                info: updateInfo || undefined,
                icon: imageUrl || false,
            },
        });
    });

    return items;
});

export default defineSource({
    agedm: today,
});
