import { myFetch } from "#/utils/fetch";
import { defineSource, generateUrlHashId } from "#/utils/source";

interface Res {
    data: {
        word_list: {
            sentence_id: string;
            word: string;
            event_time: string;
            hot_value: string;
        }[];
    };
}

export default defineSource(async () => {
    const url =
        "https://www.douyin.com/aweme/v1/web/hot/search/list/?device_platform=webapp&aid=6383&channel=channel_pc_web&detail_list=1";
    const cookie = (await $fetch.raw("https://login.douyin.com/")).headers.getSetCookie();
    const res: Res = await myFetch(url, {
        headers: {
            cookie: cookie.join("; "),
        },
    });
    return await Promise.all(
        res?.data.word_list.map(async (k) => {
            const fulUrl = `https://www.douyin.com/hot/${k.sentence_id}`;
            const hashId = await generateUrlHashId(fulUrl);
            return {
                id: hashId,
                title: k.word,
                url: fulUrl,
            };
        })
    );
});
