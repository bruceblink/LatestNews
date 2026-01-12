import dayjs from "dayjs/esm";
import { myFetch } from "#/utils/fetch";
import { defineSource, generateUrlHashId } from "#/utils/source";

type KxResp = {
    status: number;
    info: string;
    data: {
        row_map: Record<string, kxToday>; // key 是 timestamp，值是 any
        total: number;
        query_total_count: number;
        next_data: number;
    };
};

interface kxToday {
    kx_content: {
        resource_id: number;
        id: string;
        title: string;
        description: string;
        published_at: number;
        tags: {
            id: number;
            name: string;
            path: string;
        }[];
        view: number;
        likes: number;
        comments: number;
        author: {
            uid: number;
            username: string;
            avatar: string;
            introduction: string;
            baidu_statistics: string;
            is_new: string;
        };
        poster_image: string;
    }[];
    zb_content: {
        title: string;
        id: number;
        url: string;
    }[];
}

const kuaixun = defineSource(async () => {
    const kxUrl = "https://api.amz123.com/ugc/v1/user_content/kx_list";
    const now = dayjs().tz("Asia/Shanghai").startOf("day").unix(); // 今天时间
    const resp: KxResp = await myFetch<KxResp>(kxUrl, {
        method: "POST",
        headers: { Referer: "https://www.amz123.com/" },
        body: {
            is_important: -1,
            category_id: 0,
            start_time: now,
            end_time: now + 24 * 60 * 60, // 加1天
            keyword: "",
            is_query_zb: 1,
            is_query_total_count: 0,
        },
    });
    const today = now.toString();
    const kxToday = resp?.data?.row_map[today];

    return await Promise.all(
        kxToday?.kx_content?.map(async (item) => {
            const fullUrl = `https://www.amz123.com/kx/${item?.id}`;
            //const readable = dayjs(item?.published_at * 1000).format("YYYY-MM-DD HH:mm:ss");
            const hashId = await generateUrlHashId(fullUrl);
            return {
                id: hashId,
                title: item?.title,
                url: fullUrl,
                pubDate: item?.published_at * 1000,
                extra: {
                    hover: `${item?.description}`,
                },
            };
        })
    );
});

export default defineSource({
    "amz123-kx": kuaixun,
});
