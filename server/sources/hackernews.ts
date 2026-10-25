import type { NewsItem } from "@shared/types";

import { myFetch as defaultFetch } from "../utils/fetch";
import { defineSource, generateUrlHashId } from "../utils/source";

import type { myFetch } from "../utils/fetch";

export const HACKER_NEWS_FRONT_PAGE_URL = "https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=30";

interface HackerNewsFrontPageHit {
    objectID: string;
    title: string;
    points?: number;
}

/** Fetches the current front-page stories without depending on HN's HTML markup. */
export async function fetchHackerNewsItems(fetcher: typeof myFetch = defaultFetch): Promise<NewsItem[]> {
    const response: unknown = await fetcher(HACKER_NEWS_FRONT_PAGE_URL, { responseType: "json" });
    if (!isRecord(response) || !Array.isArray(response.hits)) {
        throw new Error("Invalid Hacker News Search API response.");
    }

    const hits = response.hits.filter(isHackerNewsFrontPageHit).slice(0, 30);
    if (hits.length === 0) {
        throw new Error("Hacker News Search API returned no front-page stories.");
    }

    return Promise.all(
        hits.map(async (hit) => {
            const url = `https://news.ycombinator.com/item?id=${hit.objectID}`;
            return {
                id: await generateUrlHashId(url),
                title: hit.title.trim(),
                url,
                ...(hit.points !== undefined ? { extra: { info: `${hit.points} points` } } : {}),
            };
        })
    );
}

export default defineSource(fetchHackerNewsItems);

function isHackerNewsFrontPageHit(value: unknown): value is HackerNewsFrontPageHit {
    if (!isRecord(value) || typeof value.objectID !== "string" || !/^\d+$/.test(value.objectID)) return false;
    if (typeof value.title !== "string" || !value.title.trim()) return false;
    return value.points === undefined || (typeof value.points === "number" && Number.isFinite(value.points));
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
