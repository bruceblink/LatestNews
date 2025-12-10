import { load } from "cheerio";
import { myFetch } from "#/utils/fetch";
import { defineSource, generateUrlHashId } from "#/utils/source";

import { genHeaders } from "./utils";

interface Res {
    data: {
        id: string;
        // 多行
        message: string;
        // 起的标题
        editor_title: string;
        url: string;
        entityType: string;
        pubDate: string;
        // dayjs(dateline, 'X')
        dateline: number;
        targetRow: {
            // 374.4万热度
            subTitle: string;
        };
    }[];
}

export default defineSource({
    coolapk: async () => {
        const url =
            "https://api.coolapk.com/v6/page/dataList?url=%2Ffeed%2FstatList%3FcacheExpires%3D300%26statType%3Dday%26sortField%3Ddetailnum%26title%3D%E4%BB%8A%E6%97%A5%E7%83%AD%E9%97%A8&title=%E4%BB%8A%E6%97%A5%E7%83%AD%E9%97%A8&subTitle=&page=1";
        const r: Res = await myFetch(url, {
            headers: await genHeaders(),
        });
        if (!r.data.length) throw new Error("Failed to fetch");
        return await Promise.all(
            r?.data
                .filter((k) => k.id)
                .map(async (i) => {
                    const fullUrl = `https://www.coolapk.com${i.url}`;
                    const hashId = await generateUrlHashId(fullUrl);

                    return {
                        id: hashId,
                        title: i.editor_title || load(i.message).text().split("\n")[0],
                        url: fullUrl,
                        extra: {
                            info: i.targetRow?.subTitle,
                            // date: new Date(i.dateline * 1000).getTime(),
                        },
                    };
                })
        );
    },
});
