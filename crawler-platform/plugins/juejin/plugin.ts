import { defineCrawlerPlugin } from "../../sdk/plugin";
import { CrawlerPlatformError } from "../../core/errors";
import { createLegacyUrlHashId } from "../../sdk/legacy-id";

const manifest = {
    manifestVersion: 1,
    id: "org.latestnews.juejin",
    name: "稀土掘金",
    version: "0.1.0",
    apiVersion: "^1.0.0",
    runtime: "trusted-js",
    entry: "plugin.mjs",
    targets: ["node", "electron"],
    permissions: {
        network: [{ origin: "https://api.juejin.cn", methods: ["GET"] }],
    },
    sources: [
        {
            id: "juejin",
            name: "稀土掘金",
            kind: "hottest",
            refreshIntervalSeconds: 600,
            column: "tech",
            home: "https://juejin.cn",
        },
    ],
} as const;

interface JuejinArticle {
    content?: {
        title?: string;
        content_id?: string;
    };
}

interface JuejinResponse {
    data?: JuejinArticle[];
}

export const juejinPlugin = defineCrawlerPlugin(manifest, {
    async collect(context, request) {
        if (request.sourceId !== "juejin") {
            throw new CrawlerPlatformError("SOURCE_NOT_FOUND", `Unknown Juejin source ${request.sourceId}.`);
        }

        const response = await context.http.request({
            url: "https://api.juejin.cn/content_api/v1/content/article_rank?category_id=1&type=hot&spider=0",
            headers: { accept: "application/json" },
        });
        if (response.status < 200 || response.status >= 300) {
            throw new CrawlerPlatformError("HTTP_FAILED", `Juejin API returned status ${response.status}.`);
        }

        let payload: JuejinResponse;
        try {
            payload = JSON.parse(response.body) as JuejinResponse;
        } catch {
            throw new CrawlerPlatformError("INVALID_PLUGIN", "Juejin API returned invalid JSON.");
        }

        if (!Array.isArray(payload.data)) {
            throw new CrawlerPlatformError("INVALID_PLUGIN", "Juejin API response does not contain data.");
        }
        if (payload.data.length === 0) {
            throw new CrawlerPlatformError("INVALID_PLUGIN", "Juejin API response contains no articles.");
        }

        return Promise.all(
            payload.data.flatMap((entry) => {
                const title = entry.content?.title?.trim();
                const contentId = entry.content?.content_id?.trim();
                if (!title || !contentId) return [];
                const url = `https://juejin.cn/post/${contentId}`;
                return [
                    createLegacyUrlHashId(url).then((id) => ({
                        id,
                        title,
                        url,
                    })),
                ];
            })
        );
    },
});

export default juejinPlugin;
