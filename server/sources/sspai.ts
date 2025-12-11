import { myFetch } from "../utils/fetch";
import { defineSource, generateUrlHashId } from "../utils/source";

interface Res {
    data: {
        id: number;
        title: string;
    }[];
}

export default defineSource(async () => {
    const timestamp = Date.now();
    const limit = 30;
    const url = `https://sspai.com/api/v1/article/tag/page/get?limit=${limit}&offset=0&created_at=${timestamp}&tag=%E7%83%AD%E9%97%A8%E6%96%87%E7%AB%A0&released=false`;
    const res: Res = await myFetch(url);
    return await Promise.all(
        res?.data.map(async (k) => {
            const fulUrl = `https://sspai.com/post/${k.id}`;
            const hashId = await generateUrlHashId(fulUrl);

            return {
                id: hashId,
                title: k.title,
                url: fulUrl,
            };
        })
    );
});
