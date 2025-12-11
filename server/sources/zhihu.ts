import { myFetch } from "../utils/fetch";
import { defineSource, generateUrlHashId } from "../utils/source";

interface Res {
    data: {
        type: "hot_list_feed";
        style_type: "1";
        feed_specific: {
            answer_count: 411;
        };
        target: {
            title_area: {
                text: string;
            };
            excerpt_area: {
                text: string;
            };
            image_area: {
                url: string;
            };
            metrics_area: {
                text: string;
                font_color: string;
                background: string;
                weight: string;
            };
            label_area: {
                type: "trend";
                trend: number;
                night_color: string;
                normal_color: string;
            };
            link: {
                url: string;
            };
        };
    }[];
}

export default defineSource({
    zhihu: async () => {
        const url = "https://www.zhihu.com/api/v3/feed/topstory/hot-list-web?limit=20&desktop=true";
        const res: Res = await myFetch(url);
        return await Promise.all(
            res.data.map(async (k) => {
                const hashId = await generateUrlHashId(k.target.link.url);
                return {
                    id: hashId,
                    title: k.target.title_area.text,
                    extra: {
                        info: k.target.metrics_area.text,
                        hover: k.target.excerpt_area.text,
                    },
                    url: k.target.link.url,
                };
            })
        );
    },
});
