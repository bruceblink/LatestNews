import { proxyPicture } from "#/utils/proxy.ts";

import { myFetch } from "../utils/fetch";
import { defineSource, generateUrlHashId } from "../utils/source";

interface JiqizhixinItem {
    success: boolean;
    articles: {
        id: string;
        title: string;
        coverImageUrl: string;
        category: string;
        slug: string;
        tagList: string[];
        author: string;
        publishedAt: string;
        content: string;
        source: string;
    }[];
    tags: string[];
    totalCount: number;
    hasNextPage: boolean;
    publishedArticlesCount: number;
    elapsedDays: number;
}

export default defineSource(async () => {
    const url = "https://www.jiqizhixin.com/api/article_library/articles.json?sort=time";

    const res: JiqizhixinItem = await myFetch(url, {
        headers: {
            "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
            Referer: "https://www.jiqizhixin.com",
            "Content-Type": "application/json; charset=utf-8",
        },
    });

    return await Promise.all(
        res.articles.map(async (article) => {
            const fulUrl = `https://www.jiqizhixin.com/articles/${article.slug}`;
            const hashId = await generateUrlHashId(fulUrl);

            return {
                id: hashId,
                title: article.title,
                url: fulUrl,
                pubDate: article.publishedAt,
                extra: {
                    info: article.tagList.join("  |  "),
                    hover: article.content,
                    icon: proxyPicture(article.coverImageUrl),
                },
            };
        })
    );
});
