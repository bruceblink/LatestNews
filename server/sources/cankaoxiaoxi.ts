import { myFetch } from "../utils/fetch";
import { tranformToUTC } from "../utils/date";
import { defineSource, generateUrlHashId } from "../utils/source";

interface Res {
    list: {
        data: {
            id: string;
            title: string;
            // 北京时间
            url: string;
            publishTime: string;
        };
    }[];
}

export default defineSource(async () => {
    const res = await Promise.all(
        ["zhongguo", "guandian", "gj"].map(
            (k) => myFetch(`https://china.cankaoxiaoxi.com/json/channel/${k}/list.json`) as Promise<Res>
        )
    );

    const flatList = res.flatMap((k) => k.list);

    const items = await Promise.all(
        flatList.map(async (k) => {
            const fullUrl = k.data.url;
            const hashId = await generateUrlHashId(fullUrl);

            return {
                id: hashId,
                title: k.data.title,
                extra: {
                    date: tranformToUTC(k.data.publishTime),
                },
                url: fullUrl,
            };
        })
    );

    return items.sort((m, n) => (m.extra.date < n.extra.date ? 1 : -1));
});
