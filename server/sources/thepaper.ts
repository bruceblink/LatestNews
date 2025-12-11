import { myFetch } from "../utils/fetch";
import { defineSource, generateUrlHashId } from "../utils/source";

interface Res {
    data: {
        hotNews: {
            contId: string;
            name: string;
            pubTimeLong: string;
        }[];
    };
}

export default defineSource(async () => {
    const url = "https://cache.thepaper.cn/contentapi/wwwIndex/rightSidebar";
    const res: Res = await myFetch(url);
    return await Promise.all(
        res.data.hotNews.map(async (k) => {
            const fulUrl = `https://www.thepaper.cn/newsDetail_forward_${k.contId}`;
            const hashId = await generateUrlHashId(fulUrl);

            return {
                id: hashId,
                title: k.name,
                url: fulUrl,
                mobileUrl: fulUrl,
            };
        })
    );
});
