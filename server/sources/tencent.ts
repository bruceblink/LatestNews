import { myFetch } from "#/utils/fetch";
import { describeSourceError } from "@shared/source-error";
import { defineSource, generateUrlHashId } from "#/utils/source";

interface WapRes {
    ret: number;
    msg: string;
    data: {
        id: number;
        name: string;
        lead: string;
        cover?: string;
        shareTitle: string;
        shareAbstract: string;
        sharePic: string;
        is724: boolean;
        is724Paper: boolean;
        head_cmsid: string;
        feed_style: number;
        head_article: {
            live_info: string;
            title: string;
            img: string;
            pub_time: string;
            media_name: string;
        };
        paperInfo: any;
        tabs: {
            id: string;
            channel_id: string;
            name: string;
            source: string;
            type: string;
            articleList: any[];
            article_count: number;
            sub_tab: string;
        }[];
        banner: string;
    };
}

/**
 * 综合早报
 */
const comprehensiveNews = defineSource(async () => {
    try {
        const url = "https://i.news.qq.com/web_backend/v2/getTagInfo?tagId=aEWqxLtdgmQ%3D";
        const res = await myFetch<WapRes>(url, { headers: { Referer: "https://news.qq.com/" } });

        const articles = res?.data?.tabs?.[0]?.articleList ?? []; // 👈 空数组兜底

        return await Promise.all(
            articles.map(async (news) => {
                // 构建完整URL
                const fullUrl = news.link_info.url;

                const hashId = await generateUrlHashId(fullUrl);
                return {
                    id: hashId,
                    title: news.title,
                    url: news.link_info.url,
                    extra: { hover: news.desc },
                };
            })
        );
    } catch (err) {
        console.error("获取腾讯新闻-综合早报失败:", describeSourceError(err));
        return []; // 优雅降级
    }
});

export default defineSource({
    "tencent-hot": comprehensiveNews,
});
