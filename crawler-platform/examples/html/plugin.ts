import { load } from "cheerio";

import { defineCrawlerPlugin } from "../../sdk/plugin";
import { CrawlerPlatformError } from "../../core/errors";

const manifest = {
    manifestVersion: 1,
    id: "org.latestnews.example-html",
    name: "Example HTML Feed",
    version: "0.1.0",
    apiVersion: "^1.0.0",
    runtime: "trusted-js",
    entry: "plugin.mjs",
    targets: ["node", "electron"],
    permissions: {
        network: [{ origin: "https://html.example.test", methods: ["GET"] }],
    },
    sources: [{ id: "latest", name: "Latest", kind: "timeline", refreshIntervalSeconds: 600 }],
} as const;

export const htmlExamplePlugin = defineCrawlerPlugin(manifest, {
    async collect(context, request) {
        if (request.sourceId !== "latest") {
            throw new CrawlerPlatformError("SOURCE_NOT_FOUND", `Unknown HTML source ${request.sourceId}.`);
        }

        const response = await context.http.request({ url: "https://html.example.test/news" });
        if (response.status < 200 || response.status >= 300) {
            throw new CrawlerPlatformError("HTTP_FAILED", `HTML feed returned status ${response.status}.`);
        }

        const $ = load(response.body);
        return $("article.news")
            .toArray()
            .map((article) => {
                const row = $(article);
                const link = row.find("a").first();
                const date = row.find("time").attr("datetime");
                return {
                    title: link.text(),
                    url: new URL(link.attr("href") ?? "", "https://html.example.test").href,
                    ...(date ? { publishedAt: date } : {}),
                };
            });
    },
});

export default htmlExamplePlugin;
