import { defineCrawlerPlugin } from "../../../crawler-platform/sdk/plugin";

const manifest = {
    manifestVersion: 1,
    id: "org.latestnews.server-smoke",
    name: "Node server integration smoke",
    version: "0.1.0",
    apiVersion: "^1.0.0",
    runtime: "trusted-js",
    entry: "plugin.mjs",
    targets: ["node"],
    permissions: { network: [] },
    sources: [
        {
            id: "hackernews",
            name: "Hacker News",
            kind: "hottest",
            refreshIntervalSeconds: 600,
        },
    ],
} as const;

export default defineCrawlerPlugin(manifest, {
    async collect() {
        return [
            {
                id: "server-smoke-1",
                title: "Server plugin API smoke",
                url: "https://smoke.example.test/story/1",
                publishedAt: "2026-10-18T00:00:00.000Z",
            },
        ];
    },
});
