import { myFetch } from "#/utils/fetch";
import { defineSource, generateUrlHashId } from "#/utils/source";

interface Res {
    version: string;
    title: string;
    description: string;
    home_page_url: string;
    feed_url: string;
    icon: string;
    favicon: string;
    items: {
        url: string;
        date_modified?: string;
        content_html: string;
        date_published: string;
        title: string;
        id: string;
    }[];
}

const share = defineSource(async () => {
    const cats = ["create", "ideas", "programmer", "share"];

    const feeds = await Promise.all(cats.map((k) => myFetch(`https://www.v2ex.com/feed/${k}.json`) as Promise<Res>));

    const items = feeds.flatMap((f) => f.items);

    const results = await Promise.all(
        items.map(async (item) => ({
            id: await generateUrlHashId(item.url),
            title: item.title,
            url: item.url,
            extra: {
                date: Date.parse(item.date_modified ?? item.date_published),
            },
        }))
    );

    return results.sort((a, b) => b.extra.date - a.extra.date);
});

export default defineSource({
    v2ex: share,
    "v2ex-share": share,
});
