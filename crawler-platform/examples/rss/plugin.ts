import { readRssItems } from "../../sdk/rss";
import { defineCrawlerPlugin } from "../../sdk/plugin";
import { CrawlerPlatformError } from "../../core/errors";

const manifest = {
    manifestVersion: 1,
    id: "org.latestnews.example-rss",
    name: "Example RSS Feed",
    version: "0.1.0",
    apiVersion: "^1.0.0",
    runtime: "trusted-js",
    entry: "plugin.mjs",
    targets: ["node", "electron"],
    permissions: {
        network: [{ origin: "https://rss.example.test", methods: ["GET"] }],
    },
    sources: [{ id: "latest", name: "Latest", kind: "realtime", refreshIntervalSeconds: 900 }],
} as const;

export const rssExamplePlugin = defineCrawlerPlugin(manifest, {
    async collect(context, request) {
        if (request.sourceId !== "latest") {
            throw new CrawlerPlatformError("SOURCE_NOT_FOUND", `Unknown RSS source ${request.sourceId}.`);
        }

        const items = await readRssItems(context, "https://rss.example.test/feed.xml");
        return items.map((item) => ({
            id: item.guid,
            title: item.title,
            url: item.url,
            publishedAt: item.publishedAt,
        }));
    },
});

export default rssExamplePlugin;
