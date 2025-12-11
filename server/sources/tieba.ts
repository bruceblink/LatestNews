import { myFetch } from "../utils/fetch";
import { defineSource, generateUrlHashId } from "../utils/source";

interface Res {
    data: {
        bang_topic: {
            topic_list: {
                topic_id: string;
                topic_name: string;
                create_time: number;
                topic_url: string;
            }[];
        };
    };
}

export default defineSource(async () => {
    const url = "https://tieba.baidu.com/hottopic/browse/topicList";
    const res: Res = await myFetch(url);
    return await Promise.all(
        res?.data?.bang_topic?.topic_list?.map(async (k) => {
            const hashId = await generateUrlHashId(k.topic_url);

            return {
                id: hashId,
                title: k.topic_name,
                url: k.topic_url,
            };
        })
    );
});
