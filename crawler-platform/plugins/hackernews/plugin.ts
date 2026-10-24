import { load } from "cheerio";

import { defineCrawlerPlugin } from "../../sdk/plugin";
import { CrawlerPlatformError } from "../../core/errors";
import { createLegacyUrlHashId } from "../../sdk/legacy-id";

const manifest = {
    manifestVersion: 1,
    id: "org.latestnews.hackernews",
    name: "Hacker News",
    version: "0.1.0",
    apiVersion: "^1.0.0",
    runtime: "trusted-js",
    entry: "plugin.mjs",
    targets: ["node", "electron"],
    permissions: {
        network: [{ origin: "https://news.ycombinator.com", methods: ["GET"] }],
    },
    sources: [
        {
            id: "hackernews",
            name: "Hacker News",
            kind: "hottest",
            refreshIntervalSeconds: 600,
            column: "tech",
            home: "https://news.ycombinator.com/",
        },
    ],
} as const;

export const hackernewsPlugin = defineCrawlerPlugin(manifest, {
    async collect(context, request) {
        if (request.sourceId !== "hackernews") {
            throw new CrawlerPlatformError("SOURCE_NOT_FOUND", `Unknown Hacker News source ${request.sourceId}.`);
        }

        const response = await context.http.request({
            url: "https://news.ycombinator.com",
            headers: { accept: "text/html" },
        });
        if (response.status < 200 || response.status >= 300) {
            throw new CrawlerPlatformError("HTTP_FAILED", `Hacker News returned status ${response.status}.`);
        }

        const $ = load(response.body);
        const rows = $(".athing").toArray();
        if (rows.length === 0) {
            throw new CrawlerPlatformError("INVALID_PLUGIN", "Hacker News page contains no story rows.");
        }
        return Promise.all(
            rows.flatMap((row) => {
                const element = $(row);
                const title = element.find(".titleline a").first().text().trim();
                const id = element.attr("id");
                if (!title || !id) return [];
                const url = `https://news.ycombinator.com/item?id=${id}`;
                const info = $(`#score_${id}`).text().trim();
                return [
                    createLegacyUrlHashId(url).then((itemId) => ({
                        id: itemId,
                        title,
                        url,
                        ...(info ? { extra: { info } } : {}),
                    })),
                ];
            })
        );
    },
});

export default hackernewsPlugin;
