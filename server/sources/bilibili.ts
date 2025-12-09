import { myFetch } from "#/utils/fetch";
import { proxyPicture } from "#/utils/proxy";
import { defineSource, generateUrlHashId } from "#/utils/source";

interface WapRes {
    code: number;
    exp_str: string;
    list: {
        hot_id: number;
        keyword: string;
        show_name: string;
        score: number;
        word_type: number;
        goto_type: number;
        goto_value: string;
        icon: string;
        live_id: any[];
        call_reason: number;
        heat_layer: string;
        pos: number;
        id: number;
        status: string;
        name_type: string;
        resource_id: number;
        set_gray: number;
        card_values: any[];
        heat_score: number;
        stat_datas: {
            etime: string;
            stime: string;
            is_commercial: string;
        };
    }[];
    top_list: any[];
    hotword_egg_info: string;
    seid: string;
    timestamp: number;
    total_count: number;
}

// Interface for Bilibili Hot Video response
interface HotVideoRes {
    code: number;
    message: string;
    ttl: number;
    data: {
        list: {
            aid: number;
            videos: number;
            tid: number;
            tname: string;
            copyright: number;
            pic: string;
            title: string;
            pubdate: number;
            ctime: number;
            desc: string;
            state: number;
            duration: number;
            owner: {
                mid: number;
                name: string;
                face: string;
            };
            stat: {
                view: number;
                danmaku: number;
                reply: number;
                favorite: number;
                coin: number;
                share: number;
                now_rank: number;
                his_rank: number;
                like: number;
                dislike: number;
            };
            dynamic: string;
            cid: number;
            dimension: {
                width: number;
                height: number;
                rotate: number;
            };
            short_link: string;
            short_link_v2: string;
            bvid: string;
            rcmd_reason: {
                content: string;
                corner_mark: number;
            };
        }[];
    };
}

const hotSearch = defineSource(async () => {
    const url = "https://s.search.bilibili.com/main/hotword?limit=30";
    //const res: WapRes = await myFetch(url);
    const res: WapRes = await myFetch(url, {
        headers: {
            "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
            Referer: "https://www.bilibili.com/",
        },
    });
    return await Promise.all(
        res.list.map(async (k) => {
            const fulUrl = `https://search.bilibili.com/all?keyword=${encodeURIComponent(k.keyword)}`;
            const hashId = await generateUrlHashId(fulUrl);
            return {
                id: hashId,
                title: k.show_name,
                url: fulUrl,
                extra: {
                    icon: k.icon && proxyPicture(k.icon),
                },
            };
        })
    );
});

const hotVideo = defineSource(async () => {
    const url = "https://api.bilibili.com/x/web-interface/popular";
    const res: HotVideoRes = await myFetch(url, {
        headers: {
            "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
            Referer: "https://www.bilibili.com/",
        },
    });

    return await Promise.all(
        res.data.list.map(async (video) => {
            const fulUrl = `https://www.bilibili.com/video/${video.bvid}`;
            const hashId = await generateUrlHashId(fulUrl);

            return {
                id: hashId,
                title: video.title,
                url: fulUrl,
                pubDate: video.pubdate * 1000,
                extra: {
                    info: `${video.owner.name} · ${formatNumber(video.stat.view)}观看 · ${formatNumber(video.stat.like)}点赞`,
                    hover: video.desc,
                    icon: proxyPicture(video.pic),
                },
            };
        })
    );
});

const ranking = defineSource(async () => {
    const url = "https://api.bilibili.com/x/web-interface/ranking/v2";
    const res: HotVideoRes = await myFetch(url, {
        headers: {
            "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
            Referer: "https://www.bilibili.com/",
        },
    });

    return await Promise.all(
        res.data.list.map(async (video) => {
            const fulUrl = `https://www.bilibili.com/video/${video.bvid}`;
            const hashId = await generateUrlHashId(fulUrl);

            return {
                id: hashId,
                title: video.title,
                url: fulUrl,
                pubDate: video.pubdate * 1000,
                extra: {
                    info: `${video.owner.name} · ${formatNumber(video.stat.view)}观看 · ${formatNumber(video.stat.like)}点赞`,
                    hover: video.desc,
                    icon: proxyPicture(video.pic),
                },
            };
        })
    );
});

function formatNumber(num: number): string {
    if (num >= 10000) {
        return `${Math.floor(num / 10000)}w+`;
    }
    return num.toString();
}

export default defineSource({
    bilibili: hotSearch,
    "bilibili-hot-search": hotSearch,
    "bilibili-hot-video": hotVideo,
    "bilibili-ranking": ranking,
});
