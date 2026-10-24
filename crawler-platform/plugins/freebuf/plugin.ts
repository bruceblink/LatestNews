import { readRssItems } from "../../sdk/rss";
import { defineCrawlerPlugin } from "../../sdk/plugin";
import { CrawlerPlatformError } from "../../core/errors";
import { createLegacyUrlHashId } from "../../sdk/legacy-id";

const manifest = {
    manifestVersion: 1,
    id: "org.latestnews.freebuf",
    name: "Freebuf",
    version: "0.1.0",
    apiVersion: "^1.0.0",
    runtime: "trusted-js",
    entry: "plugin.mjs",
    targets: ["node", "electron"],
    permissions: {
        network: [{ origin: "https://www.freebuf.com", methods: ["GET"] }],
    },
    sources: [
        {
            id: "freebuf",
            name: "Freebuf",
            kind: "hottest",
            refreshIntervalSeconds: 600,
            column: "china",
            title: "网络安全",
            home: "https://www.freebuf.com/",
        },
    ],
} as const;

export const freebufPlugin = defineCrawlerPlugin(manifest, {
    async collect(context, request) {
        if (request.sourceId !== "freebuf") {
            throw new CrawlerPlatformError("SOURCE_NOT_FOUND", `Unknown Freebuf source ${request.sourceId}.`);
        }

        const items = await readRssItems(context, "https://www.freebuf.com/rss");
        if (items.length === 0) throw new CrawlerPlatformError("HTTP_FAILED", "Cannot fetch Freebuf RSS data.");

        return Promise.all(
            items.map(async (item) => ({
                id: await createLegacyUrlHashId(item.url),
                title: item.title,
                url: item.url,
                ...(item.publishedAt ? { publishedAt: item.publishedAt } : {}),
            }))
        );
    },
});

export default freebufPlugin;
