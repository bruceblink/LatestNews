import { myFetch } from "../utils/fetch";
import { defineSource, generateUrlHashId } from "../utils/source";

interface Report {
    id: string;
    type: number;
    time: string;
    important: number;
    data: {
        content: string;
        pic: string;
        title: string;
    };
    remark: any[];
    hot: boolean;
    hot_start: string | null;
    hot_end: string | null;
    classify: {
        id: number;
        pid: number;
        name: string;
        parent: string;
    }[];
    impact: any[];
}

interface Res {
    status: number;
    data: Report[];
    message: string;
}

const flash = defineSource(async () => {
    const res: Res = await myFetch("https://api.mktnews.net/api/flash?type=0&limit=50");

    return await Promise.all(
        res.data
            .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
            .map(async (item) => {
                const fulUrl = `https://mktnews.net/flashDetail.html?id=${item.id}`;
                const hashId = await generateUrlHashId(fulUrl);
                return {
                    id: hashId,
                    title: item.data.title || item.data.content.match(/^【([^】]*)】(.*)$/)?.[1] || item.data.content,
                    pubDate: item.time,
                    extra: {
                        info: item.important === 1 ? "Important" : undefined,
                        hover: item.data.content,
                    },
                    url: hashId,
                };
            })
    );
});

export default defineSource({
    mktnews: flash,
    "mktnews-flash": flash,
});
