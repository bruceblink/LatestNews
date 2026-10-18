import { readRssItems } from "../../sdk/rss";
import { defineCrawlerPlugin } from "../../sdk/plugin";
import { CrawlerPlatformError } from "../../core/errors";
import { createLegacyUrlHashId } from "../../sdk/legacy-id";

const manifest = {
    manifestVersion: 1,
    id: "org.latestnews.pcbeta",
    name: "远景论坛",
    version: "0.1.0",
    apiVersion: "^1.0.0",
    runtime: "trusted-js",
    entry: "plugin.mjs",
    targets: ["node", "electron"],
    permissions: {
        network: [{ origin: "https://bbs.pcbeta.com", methods: ["GET"] }],
    },
    sources: [
        {
            id: "pcbeta-windows11",
            name: "Win11",
            kind: "realtime",
            refreshIntervalSeconds: 300,
        },
    ],
} as const;

const feeds: Readonly<Record<string, string>> = {
    "pcbeta-windows11": "https://bbs.pcbeta.com/forum.php?mod=rss&fid=563&auth=0",
};

export const pcbetaPlugin = defineCrawlerPlugin(manifest, {
    async collect(context, request) {
        const feedUrl = feeds[request.sourceId];
        if (!feedUrl) {
            throw new CrawlerPlatformError("SOURCE_NOT_FOUND", `Unknown Pcbeta feed ${request.sourceId}.`);
        }

        const feedItems = await readRssItems(context, feedUrl);
        if (feedItems.length === 0) throw new CrawlerPlatformError("HTTP_FAILED", "Cannot fetch rss data.");

        return Promise.all(
            feedItems.map(async (item) => ({
                id: await createLegacyUrlHashId(item.url),
                title: item.title,
                url: item.url,
                publishedAt: item.publishedAt,
            }))
        );
    },
});

export default pcbetaPlugin;
