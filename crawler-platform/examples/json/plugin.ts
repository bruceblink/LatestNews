import { defineCrawlerPlugin } from "../../sdk/plugin";
import { CrawlerPlatformError } from "../../core/errors";

const manifest = {
    manifestVersion: 1,
    id: "org.latestnews.example-json",
    name: "Example JSON Feed",
    version: "0.1.0",
    apiVersion: "^1.0.0",
    runtime: "trusted-js",
    entry: "plugin.mjs",
    targets: ["node", "electron"],
    permissions: {
        network: [{ origin: "https://json.example.test", methods: ["GET"] }],
    },
    sources: [
        {
            id: "latest",
            name: "Latest",
            kind: "timeline",
            refreshIntervalSeconds: 300,
            column: "tech",
            title: "示例 JSON",
            description: "展示如何声明运行时来源信息。",
            home: "https://json.example.test",
        },
    ],
} as const;

interface JsonArticle {
    id?: string | number;
    title?: string;
    url?: string;
    publishedAt?: string | number;
}

export const jsonExamplePlugin = defineCrawlerPlugin(manifest, {
    async collect(context, request) {
        if (request.sourceId !== "latest") {
            throw new CrawlerPlatformError("SOURCE_NOT_FOUND", `Unknown JSON feed source ${request.sourceId}.`);
        }

        const response = await context.http.request({ url: "https://json.example.test/news.json" });
        if (response.status < 200 || response.status >= 300) {
            throw new CrawlerPlatformError("HTTP_FAILED", `JSON feed returned status ${response.status}.`);
        }

        const payload: unknown = JSON.parse(response.body);
        if (!isRecord(payload) || !Array.isArray(payload.items)) {
            throw new CrawlerPlatformError("INVALID_OUTPUT", "JSON feed does not contain an items array.");
        }

        return payload.items.map((item: JsonArticle) => ({
            id: item.id,
            title: item.title,
            url: item.url,
            publishedAt: item.publishedAt,
        }));
    },
});

export default jsonExamplePlugin;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
