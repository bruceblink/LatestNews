import { myFetch } from "../utils/fetch";
import { defineSource, generateUrlHashId } from "../utils/source";

interface Res {
    data: {
        result: {
            id: string;
            title: string;
            type: number;
            uuid: string;
        }[];
    };
}

export default defineSource(async () => {
    const timestamp = Date.now();
    const baseUrl = `https://gw-c.nowcoder.com/api/sparta/hot-search/top-hot-pc?size=20&_=${timestamp}&t=`;
    const res: Res = await myFetch(baseUrl);

    const tasks = res.data.result.flatMap((k) => {
        let url: string = "";

        if (k.type === 74) url = `https://www.nowcoder.com/feed/main/detail/${k.uuid}`;
        else if (k.type === 0) url = `https://www.nowcoder.com/discuss/${k.id}`;
        else return [];

        return [
            (async () => {
                const hashId = await generateUrlHashId(url!);
                return {
                    id: hashId,
                    title: k.title,
                    url,
                };
            })(),
        ];
    });

    return await Promise.all(tasks);
});
