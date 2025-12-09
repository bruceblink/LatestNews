import { myFetch } from "../utils/fetch";
import { defineSource, generateUrlHashId } from "../utils/source";

interface HotMoviesRes {
    category: string;
    tags: [];
    items: MovieItem[];
    recommend_tags: [];
    total: number;
    type: string;
}

interface MovieItem {
    rating: {
        count: number;
        max: number;
        star_count: number;
        value: number;
    };
    title: string;
    pic: {
        large: string;
        normal: string;
    };
    is_new: boolean;
    uri: string;
    episodes_info: string;
    card_subtitle: string;
    type: string;
    id: string;
}

export default defineSource(async () => {
    try {
        const baseURL = "https://m.douban.com/rexxar/api/v2/subject/recent_hot/movie";
        const res = await myFetch<HotMoviesRes>(baseURL, {
            headers: {
                "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
                Referer: "https://movie.douban.com/",
                Accept: "application/json, text/plain, */*",
            },
        });

        return await Promise.all(
            res?.items?.map(async (movie) => {
                const fullUrl = `https://movie.douban.com/subject/${movie.id}`;

                const hashId = await generateUrlHashId(fullUrl);
                return {
                    id: hashId,
                    title: movie.title,
                    url: fullUrl,
                    extra: {
                        info: movie.card_subtitle.split(" / ").slice(0, 3).join(" / "),
                        hover: movie.card_subtitle,
                    },
                };
            })
        );
    } catch (err) {
        console.error("获取豆瓣热门电影失败:", err);
        return []; // 优雅降级
    }
});
