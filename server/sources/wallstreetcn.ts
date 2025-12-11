import { myFetch } from "../utils/fetch";
import { defineSource, generateUrlHashId } from "../utils/source";

interface Item {
    uri: string;
    id: number;
    title?: string;
    content_text: string;
    content_short: string;
    display_time: number;
    type?: string;
}
interface LiveRes {
    data: {
        items: Item[];
    };
}

interface NewsRes {
    data: {
        items: {
            // ad
            resource_type?: string;
            resource: Item;
        }[];
    };
}

interface HotRes {
    data: {
        day_items: Item[];
    };
}

// https://github.com/DIYgod/RSSHub/blob/master/lib/routes/wallstreetcn/live.ts
const live = defineSource(async () => {
    const apiUrl = "https://api-one.wallstcn.com/apiv1/content/lives?channel=global-channel&limit=30";

    const res: LiveRes = await myFetch(apiUrl);
    return await Promise.all(
        res.data.items.map(async (k) => {
            const hashId = await generateUrlHashId(k.uri);

            return {
                id: hashId,
                title: k.title || k.content_text,
                url: k.uri,
                extra: {
                    date: k.display_time * 1000,
                },
            };
        })
    );
});

const news = defineSource(async () => {
    const apiUrl =
        "https://api-one.wallstcn.com/apiv1/content/information-flow?channel=global-channel&accept=article&limit=30";

    const res: NewsRes = await myFetch(apiUrl);
    return await Promise.all(
        res.data.items
            .filter(
                (k) =>
                    k.resource_type !== "theme" &&
                    k.resource_type !== "ad" &&
                    k.resource.type !== "live" &&
                    k.resource.uri
            )
            .map(async ({ resource: h }) => {
                const hashId = await generateUrlHashId(h.uri);

                return {
                    id: hashId,
                    title: h.title || h.content_short,
                    url: h.uri,
                    extra: {
                        date: h.display_time * 1000,
                    },
                };
            })
    );
});

const hot = defineSource(async () => {
    const apiUrl = "https://api-one.wallstcn.com/apiv1/content/articles/hot?period=all";

    const res: HotRes = await myFetch(apiUrl);
    return await Promise.all(
        res.data.day_items.map(async (h) => {
            const hashId = await generateUrlHashId(h.uri);
            return {
                id: hashId,
                title: h.title!,
                url: h.uri,
            };
        })
    );
});

export default defineSource({
    wallstreetcn: live,
    "wallstreetcn-quick": live,
    "wallstreetcn-news": news,
    "wallstreetcn-hot": hot,
});
