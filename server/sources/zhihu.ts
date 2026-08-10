import type { NewsItem } from "@shared/types";

import { myFetch } from "../utils/fetch";
import { defineSource, generateUrlHashId } from "../utils/source";

interface PrimaryHotListResponse {
    data: {
        target: {
            title_area: { text: string };
            excerpt_area?: { text: string };
            metrics_area?: { text: string };
            link: { url: string };
        };
    }[];
}

interface FallbackHotListResponse {
    data: {
        detail_text?: string;
        target: {
            excerpt?: string;
            title: string;
            url: string;
        };
    }[];
}

interface ZhihuHotEntry {
    title: string;
    url: string;
    hover?: string;
    info?: string;
}

export const ZHIHU_PRIMARY_HOT_URL = "https://www.zhihu.com/api/v3/feed/topstory/hot-list-web?limit=20&desktop=true";
export const ZHIHU_FALLBACK_HOT_URL = "https://api.zhihu.com/topstory/hot-lists/total?limit=20&reverse_order=0";

function toPublicQuestionUrl(apiUrl: string) {
    const questionId = apiUrl.match(/\/questions?\/(\d+)/)?.[1];
    return questionId ? `https://www.zhihu.com/question/${questionId}` : apiUrl;
}

export function mapZhihuPrimaryResponse(res: PrimaryHotListResponse): ZhihuHotEntry[] {
    return res.data.map((item) => ({
        title: item.target.title_area.text,
        url: item.target.link.url,
        hover: item.target.excerpt_area?.text,
        info: item.target.metrics_area?.text,
    }));
}

export function mapZhihuFallbackResponse(res: FallbackHotListResponse): ZhihuHotEntry[] {
    return res.data.map((item) => ({
        title: item.target.title,
        url: toPublicQuestionUrl(item.target.url),
        hover: item.target.excerpt,
        info: item.detail_text,
    }));
}

async function createZhihuNewsItems(entries: ZhihuHotEntry[]): Promise<NewsItem[]> {
    return await Promise.all(
        entries.map(async (entry) => ({
            id: await generateUrlHashId(entry.url),
            title: entry.title,
            url: entry.url,
            extra: {
                info: entry.info,
                hover: entry.hover,
            },
        }))
    );
}

/** Uses Zhihu's public API host when the web hot-list endpoint rejects serverless egress. */
export async function fetchZhihuHotItems(fetcher: typeof myFetch = myFetch): Promise<NewsItem[]> {
    const headers = {
        Accept: "application/json",
        Referer: "https://www.zhihu.com/hot",
    };

    try {
        const response = await fetcher<PrimaryHotListResponse>(ZHIHU_PRIMARY_HOT_URL, { headers });
        if (response.data.length) return createZhihuNewsItems(mapZhihuPrimaryResponse(response));
    } catch {
        // The fallback below uses a different Zhihu host and response contract.
    }

    const response = await fetcher<FallbackHotListResponse>(ZHIHU_FALLBACK_HOT_URL, { headers });
    return createZhihuNewsItems(mapZhihuFallbackResponse(response));
}

export default defineSource({
    zhihu: fetchZhihuHotItems,
});
