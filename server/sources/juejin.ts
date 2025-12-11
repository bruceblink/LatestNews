import { myFetch } from "../utils/fetch";
import { defineSource, generateUrlHashId } from "../utils/source";

interface Res {
    data: {
        content: {
            title: string;
            content_id: string;
        };
    }[];
}

export default defineSource(async () => {
    const url = "https://api.juejin.cn/content_api/v1/content/article_rank?category_id=1&type=hot&spider=0";
    const res: Res = await myFetch(url);
    return await Promise.all(
        res?.data.map(async (k) => {
            // eslint-disable-next-line @typescript-eslint/no-shadow
            const url = `https://juejin.cn/post/${k.content.content_id}`;
            const hashId = await generateUrlHashId(url);
            return {
                id: hashId,
                title: k.content.title,
                url,
            };
        })
    );
});
