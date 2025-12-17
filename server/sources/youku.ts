import type { NewsItem } from "@shared/types.ts";

import dayjs from "dayjs/esm";
import { myFetch } from "#/utils/fetch";
import { defineSource } from "#/utils/source";

/**
 * 优酷动漫 -追番表
 */
const webcomicToday = defineSource(async () => {
    const url = "https://www.youku.com/ku/webcomic";
    const html = await myFetch<any>(url, {
        headers: { Referer: "https://www.youku.com/ku/webhome" },
    });
    const data = extractInitialData(html);

    const modules = data?.moduleList;
    if (!Array.isArray(modules)) {
        return [];
    }

    return processModuleList(modules);
});

/**
 * 解析 __INITIAL_DATA__的配置数据
 * @param html
 */
function extractInitialData(html: string): any {
    const marker = "window.__INITIAL_DATA__";
    const idx = html.indexOf(marker);

    if (idx === -1) {
        throw new Error("未找到 __INITIAL_DATA__");
    }

    // 从 = 后开始
    const start = html.indexOf("=", idx);
    if (start === -1) {
        throw new Error("INITIAL_DATA 缺少 =");
    }

    // 找到第一个 {
    const jsonStart = html.indexOf("{", start);
    if (jsonStart === -1) {
        throw new Error("INITIAL_DATA JSON 起始 { 未找到");
    }

    // 手动匹配大括号，避免正则翻车
    let depth = 0;
    let end = jsonStart;

    for (; end < html.length; end++) {
        const ch = html[end];
        if (ch === "{") depth++;
        else if (ch === "}") {
            depth--;
            if (depth === 0) {
                end++;
                break;
            }
        }
    }

    if (depth !== 0) {
        throw new Error("INITIAL_DATA JSON 未闭合");
    }

    const rawJson = html.slice(jsonStart, end);

    const fixed = rawJson.replace(/undefined/g, "null");

    return JSON.parse(fixed);
}

/**
 * 模块解析（每日更新）
 * @param modules
 */
function processModuleList(modules: any[]): any[] {
    // 筛选出 动漫模块的数据
    const module = modules.filter((item) => item?.type === 13901);
    const components = module[0]?.components as any[];
    const itemList = components.filter((item) => item?.title === "每日更新")[0]?.itemList as any[];
    // 获取今天是一周的第几天
    const weekday = dayjs().day() || 7;
    const items = itemList[weekday - 1] as any[];

    return items.map(buildAniItem);
}

/**
 * 组装结果信息
 * @param item
 */
function buildAniItem(item: any): NewsItem {
    const title = (item?.title ?? "").trim();

    const info = [item?.desc, item?.lbTexts].filter(Boolean).join(" ");

    const hover = [item?.subtitle].filter(Boolean).join(" ");

    return {
        id: item?.id,
        title,
        url: getYoukuVideoUrl(item?.action_value, item?.scm, item?.scg_id),
        pubDate: getTodaySlash(),
        extra: {
            info,
            coverImg: (item?.img ?? "").trim(),
            hover,
        },
    } as NewsItem;
}

export function getTodaySlash(): string {
    return dayjs().format("YYYY-MM-DD");
}

function getYoukuVideoUrl(action_value: string, scm: string, scg_id: string) {
    return `https://v.youku.com/video?s=${action_value}&amp;scm=${scm}&amp;scg_id=${scg_id}`;
}

export default defineSource({
    "youku-webcomic-today": webcomicToday,
});
