import { myFetch } from "#/utils/fetch";
import { defineSource } from "#/utils/source";

interface WapResp {
    code: number;
    items: {
        order: number;
        temp: any;
        video: {
            basisDataUrls: string;
            block_id: string;
            card_source: string;
            links: any[];
            data: VideoInfo[];
            adverts: any[];
            config: any[];
        }[];
    }[];
}

interface VideoInfo {
    creator: { id: number; name: string }[];
    contributor: { id: number; name: string }[];
    showDate: string;
    tag: string;
    description: string;
    entity_id: number;
    back_image: string;
    display_name: string;
    title: string;
    show_time: string;
    desc: string;
    rank_prefix: string;
    page_url: string;
}

const hotNewTV = defineSource(async () => {
    const url =
        "https://mesh.if.iqiyi.com/portal/lw/v7/channel/card/videoTab?channelName=recommend" +
        "&data_source=v7_hotspot_coming_data&tempId=85&data_id=303001&count=30&block_id=hot_new" +
        "&device=14a4b5ba98e790dce6dc07482447cf48&from=webapp"; // 这里的device这个参数是必须的，没有的话会直接查询报错
    const resp = await myFetch<WapResp>(url, {
        headers: { Referer: "https://www.iqiyi.com" },
    });

    return resp?.items[0]?.video[0]?.data.map((item) => {
        console.log(item);
        const creator = item.creator?.map((a) => a.name).join(" ");
        const contributor = item.contributor?.map((a) => a.name).join(" ");
        const info = [item.desc, creator, contributor].filter(Boolean).join("|");
        return {
            id: item.entity_id,
            title: item.title,
            url: item.page_url,
            pubDate: item?.showDate,
            extra: {
                info,
                hover: item.description,
                tag: item.tag,
            },
        };
    });
});

export default defineSource({
    "iqiyi-tv-hot-new": hotNewTV,
});
