import type { NewsItem } from "@shared/types.ts";

import dayjs from "dayjs/esm";
import * as cheerio from "cheerio";
import { myFetch } from "#/utils/fetch";
import { defineSource } from "#/utils/source";

/**
 * 腾讯动漫
 */
const qqCartoon = defineSource(async () => {
    const url = "https://v.qq.com/channel/cartoon";
    const html: string = await myFetch<string>(url, { headers: { Referer: "https://v.qq.com/" } });

    // 1. 提取 window.__vikor__context__
    const data = extractVikorJson(html);
    const pinia = typeof data?._piniaState === "object" && data._piniaState !== null ? data._piniaState : {};

    // 2. 找到「每日更新」模块
    const daily = findDailyCard(pinia);
    if (!daily) {
        console.warn("未找到“每日更新”模块，返回空结果。");
        return [];
    }

    console.info("成功获取腾讯视频动漫数据");

    // 3. 提取今日更新视频
    const tabId: string = daily.selectedTabId ?? "";
    const todayVideos: any[] = daily.videoBannerMap?.[tabId]?.videoList ?? [];

    return todayVideos.map(buildNewsItem).filter((v): v is NewsItem => v !== null);
});

function extractVikorJson(html: string): any {
    const $ = cheerio.load(html);

    let scriptText: string | undefined;

    // eslint-disable-next-line consistent-return
    $("script").each((_, el) => {
        const text = $(el).html();
        if (text && text.includes("window.__vikor__context__")) {
            scriptText = text;
            return false;
        }
    });

    if (!scriptText) {
        console.warn("未找到包含 window.__vikor__context__ 的 <script> 标签");
        throw new Error("window.__vikor__context__ not found");
    }

    const prefix = "window.__vikor__context__=";
    const idx = scriptText.indexOf(prefix);
    if (idx === -1) {
        throw new Error("脚本内容格式不正确，无法提取 JSON");
    }

    let rawJson = scriptText.slice(idx + prefix.length);
    rawJson = rawJson.replace(/;$/, "");

    // JS → JSON 修正
    rawJson = rawJson.replace(/\bundefined\b/g, "null");

    return JSON.parse(rawJson);
}

function findDailyCard(pinia: any): any | null {
    const cards: any[] = pinia?.channelPageData?.channelsModulesMap?.["100119"]?.cardListData ?? [];

    return cards.find((c) => c?.moduleTitle === "每日更新") ?? null;
}

function buildNewsItem(item: any): NewsItem | null {
    const title = (item?.title ?? "").trim();
    if (!title) return null;

    // uniImgTag 是 JSON 字符串
    let updateCount = "";
    try {
        const uniImg = item?.uniImgTag;
        const obj = JSON.parse(uniImg);
        const text = obj?.tag_4?.text ?? "";
        const num = extractNumber(text);
        if (num === null) return null;
        updateCount = String(num);
    } catch {
        return null;
    }

    const updateCountInfo = `更新至${updateCount}集`;
    const topicLabel = (item?.topicLabel ?? "").trim();
    const updateInfo = `${updateCountInfo} ${topicLabel}`;

    //const imageUrl = (item?.coverPic ?? "").trim();
    const cid = item?.cid ?? "";
    const detailUrl = getQqVideoUrl(cid);

    return {
        id: item?.id,
        title,
        url: detailUrl,
        pubDate: getTodaySlash(),
        extra: {
            info: updateInfo,
            hover: item?.subTitle,
        },
    };
}

function extractNumber(text: string): number | null {
    const m = text.match(/\d+/);
    return m ? Number(m[0]) : null;
}

function getQqVideoUrl(cid: string): string {
    return `https://v.qq.com/x/cover/${cid}.html`;
}

function getTodaySlash(): string {
    return dayjs().format("YYYY/MM/DD");
}

interface WapResp {
    data: {
        card: {
            id: string;
            type: string;
            params: any;
            children_list: {
                list: { cards: CardRes[] };
            };
            report_infos: any;
            operations: any;
            flip_infos: any;
            static_conf: any;
            info_map: any;
            mix_data: any;
            data_type: number;
            data_style_type: number;
            data: any;
        };
        has_next_page: boolean;
        page_context: any;
        has_pre_page: boolean;
        pre_page_context: any;
    };
    ret: number;
    msg: string;
}

interface CardRes {
    id: string;
    type: string;
    params: CardParams;
    children_list: any;
    report_infos: any;
    operations: any;
    flip_infos: any;
    static_conf: any;
    info_map: any;
    mix_data: any;
    data_type: number;
    data_style_type: number;
    data: any;
}

interface CardParams {
    attent_key: string;
    "card_render@item_idx": string;
    "card_render@item_idx_max": string;
    "card_render@item_source_type": string;
    "card_render@item_type": string;
    cid: string;
    cut_end_time: string;
    cut_start_time: string;
    cut_vid: string;
    image_url: string;
    item_datakey_info: string;
    item_report: string;
    item_score: string;
    positive_content_id: string;
    rank_num: string;
    rec_normal_reason: string;
    rec_subtitle: string;
    recall_alg: string;
    recall_item_type: string;
    sub_title: string;
    title: string;
    topic_color: string;
    topic_label: string;
    type: string;
    uni_imgtag: string;
}

// 腾讯视频热搜榜
const hotSearch = defineSource(async () => {
    const url =
        "https://pbaccess.video.qq.com/trpc.vector_layout.page_view.PageService/getCard?video_appid=3000010&vversion_platform=2";
    const resp: WapResp = await myFetch<WapResp>(url, {
        method: "POST",
        headers: { Referer: "https://v.qq.com/" },
        body: {
            page_params: {
                rank_channel_id: "100113",
                rank_name: "HotSearch",
                rank_page_size: "30",
                tab_mvl_sub_mod_id: "792ac_19e77Sub_1b2",
                tab_name: "热搜榜",
                tab_type: "hot_rank",
                tab_vl_data_src: "f5200deb4596bbf3",
                page_id: "scms_shake",
                page_type: "scms_shake",
                source_key: "",
                tag_id: "",
                tag_type: "",
                new_mark_label_enabled: "1",
            },
            page_context: {
                page_index: "1",
            },
            flip_info: {
                page_strategy_id: "",
                page_module_id: "792ac_19e77",
                module_strategy_id: {},
                sub_module_id: "20251106065177",
                flip_params: {
                    folding_screen_show_num: "",
                    is_mvl: "1",
                    mvl_strategy_info:
                        '{"default_strategy_id":"06755800b45b49238582a6fa1ad0f5c5","default_version":"3836","hit_page_uuid":"b5080d97dc694a5fb50eb9e7c99326ac","hit_tab_info":null,"gray_status_info":null,"bypass_to_un_exp_id":""}',
                    mvl_sub_mod_id: "20251106065177",
                    pad_post_show_num: "",
                    pad_pro_post_show_num: "",
                    pad_pro_small_hor_pic_display_num: "",
                    pad_small_hor_pic_display_num: "",
                    page_id: "scms_shake",
                    page_num: "0",
                    page_type: "scms_shake",
                    post_show_num: "",
                    shake_size: "",
                    small_hor_pic_display_num: "",
                    source_key: "100113",
                    un_policy_id: "06755800b45b49238582a6fa1ad0f5c5",
                    un_strategy_id: "06755800b45b49238582a6fa1ad0f5c5",
                },
                relace_children_key: [],
            },
        },
    });

    return resp?.data?.card?.children_list?.list?.cards?.map((item) => {
        const uni_imgtag = JSON.parse(item?.params?.uni_imgtag);
        // 去掉空值
        const info = [item?.params?.topic_label, uni_imgtag?.tag_2?.text, uni_imgtag?.tag_4?.text]
            .filter(Boolean)
            .join(" ");
        return {
            id: item?.id,
            title: item?.params?.title,
            url: getQqVideoUrl(item?.id),
            pubDate: getTodaySlash(),
            extra: {
                info,
                hover: item?.params?.sub_title,
            },
        };
    });
});

export default defineSource({
    "qqVideo-cartoon": qqCartoon,
    "qqVideo-tv-hotSearch": hotSearch,
});
