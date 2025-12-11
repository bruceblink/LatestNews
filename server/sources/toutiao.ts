import { myFetch } from "../utils/fetch";
import { proxyPicture } from "../utils/proxy";
import { defineSource, generateUrlHashId } from "../utils/source";

interface Res {
    data: {
        ClusterIdStr: string;
        Title: string;
        HotValue: string;
        Image: {
            url: string;
        };
        LabelUri?: {
            url: string;
        };
    }[];
}

export default defineSource(async () => {
    const url = "https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc";
    const res: Res = await myFetch(url);
    return await Promise.all(
        res?.data.map(async (k) => {
            const fulUrl = `https://www.toutiao.com/trending/${k.ClusterIdStr}/`;
            const hashId = await generateUrlHashId(fulUrl);

            return {
                id: hashId,
                title: k.Title,
                url: fulUrl,
                extra: {
                    icon: k.LabelUri?.url && proxyPicture(k.LabelUri.url, "encodeBase64URL"),
                },
            };
        })
    );
});
