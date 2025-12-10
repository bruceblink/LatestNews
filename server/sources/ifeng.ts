import type { NewsItem } from "@shared/types";

import { myFetch } from "../utils/fetch";
import { defineSource, generateUrlHashId } from "../utils/source";

export default defineSource(async () => {
    const html: string = await myFetch("https://www.ifeng.com/");
    const regex = /var\s+allData\s*=\s*(\{[\s\S]*?});/;
    const match = regex.exec(html);

    if (!match) return [];

    const realData = JSON.parse(match[1]);
    const rawNews = realData?.hotNews1 as {
        url: string;
        title: string;
        newsTime: string;
    }[];

    const news: NewsItem[] = await Promise.all(
        rawNews.map(async (hotNews) => ({
            id: await generateUrlHashId(hotNews.url),
            url: hotNews.url,
            title: hotNews.title,
            extra: {
                date: hotNews.newsTime,
            },
        }))
    );

    return news;
});
