import { defineCrawlerPlugin } from "../../sdk/plugin";

const sources = Array.from({ length: 30 }, (_, index) => {
    const number = String(index + 1).padStart(2, "0");
    return {
        id: `source-${number}`,
        name: `Baseline ${number}`,
        kind: "hottest" as const,
        refreshIntervalSeconds: 300,
    };
});

const manifest = {
    manifestVersion: 1,
    id: "org.latestnews.performance",
    name: "LatestNews Performance Fixture",
    version: "0.1.0",
    apiVersion: "^1.0.0",
    runtime: "trusted-js",
    entry: "plugin.mjs",
    targets: ["node"],
    permissions: { network: [] },
    sources,
} as const;

export default defineCrawlerPlugin(manifest, {
    async collect(context, request) {
        if (!sources.some((source) => source.id === request.sourceId)) {
            throw new Error(`Unknown performance source ${request.sourceId}.`);
        }

        const itemCount = getRequestedItemCount(request.parameters);
        return Array.from({ length: itemCount }, (_, index) => {
            const itemNumber = String(index + 1).padStart(2, "0");
            return {
                id: `${request.sourceId}-item-${itemNumber}`,
                title: `Baseline item ${request.sourceId} ${itemNumber}`,
                url: `https://performance.invalid/${request.sourceId}/${itemNumber}`,
                publishedAt: context.now(),
            };
        });
    },
});

function getRequestedItemCount(parameters: unknown) {
    if (!parameters || typeof parameters !== "object" || !("itemCount" in parameters)) return 30;
    const itemCount = parameters.itemCount;
    if (typeof itemCount !== "number" || !Number.isInteger(itemCount) || itemCount < 1 || itemCount > 30) {
        throw new Error("itemCount must be an integer from 1 to 30.");
    }
    return itemCount;
}
