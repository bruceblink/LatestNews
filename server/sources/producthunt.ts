import type { NewsItem } from "@shared/types";

import process from "node:process";

import { myFetch } from "../utils/fetch";
import { defineSource, generateUrlHashId } from "../utils/source";

export default defineSource(async () => {
    const apiToken = process.env.PRODUCTHUNT_API_TOKEN;
    const token = `Bearer ${apiToken}`;
    if (!apiToken) {
        throw new Error("PRODUCTHUNT_API_TOKEN is not set");
    }
    const query = `
    query {
      posts(first: 30, order: VOTES) {
        edges {
          node {
            id
            name
            tagline
            votesCount
            url
            slug
          }
        }
      }
    }
  `;

    const response: any = await myFetch("https://api.producthunt.com/v2/api/graphql", {
        method: "POST",
        headers: {
            Authorization: token,
            "Content-Type": "application/json",
            Accept: "application/json",
        },
        body: JSON.stringify({ query }),
    });

    const posts = response?.data?.posts?.edges || [];
    const newsTasks: Promise<NewsItem | null>[] = [];
    for (const edge of posts) {
        const post = edge.node;

        if (!post.id || !post.name) continue;

        newsTasks.push(
            (async () => {
                const fullUrl = post.url || `https://www.producthunt.com/posts/${post.slug}`;
                const hashId = await generateUrlHashId(fullUrl);

                return {
                    id: hashId,
                    title: post.name,
                    url: fullUrl,
                    extra: {
                        info: ` △︎ ${post.votesCount || 0}`,
                        hover: post.tagline,
                    },
                } as NewsItem;
            })()
        );
    }
    const news = await Promise.all(newsTasks);
    return news as NewsItem[];
});
