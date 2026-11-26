import type { SourceID } from "@shared/types";

import { it, expect, describe } from "vitest";

import {
    sourceApi,
    getSourceCacheKey,
    getSourceItemsPath,
    createBearerHeaders,
    sourceHealthCacheKey,
    getSourceMetadataPath,
    sourceMetadataCacheKey,
    getUnifiedFeedCacheKey,
    getNewsInsightsCacheKey,
    deploymentHealthCacheKey,
    getSourceItemsV1CacheKey,
    getNewsInsightsRequestKey,
    getSourceMetadataItemCacheKey,
} from "../shared/source-api";

describe("source API contract", () => {
    it("keeps source endpoints centralized", () => {
        expect(sourceApi).toEqual({
            articleMaintenanceV1: "/v1/articles/maintenance",
            articleSearchV1: "/v1/articles/search",
            articleEventV1: "/v1/events",
            insightsV1: "/v1/insights",
            loginCapabilityV1: "/v1/auth/capability",
            nodeV1: "/v1/node",
            openApiV1: "/v1/openapi.json",
            sourcesV1: "/v1/sources",
            sourceBatchV1: "/v1/sources/batch",
            sourceRefreshV1: "/v1/sources/refresh",
            sourceHealthV1: "/v1/health/sources",
            deploymentHealthV1: "/v1/health/deployment",
            sourceHealthDiagnosticsV1: "/v1/health/diagnostics",
            jsonFeedV1: "/v1/feeds/json",
            rssFeedV1: "/v1/feeds/rss",
        });
    });

    it("builds stable source cache keys", () => {
        expect(getSourceCacheKey("weibo" as SourceID)).toEqual(["source", "weibo"]);
        expect(getSourceMetadataPath("weibo" as SourceID)).toBe("/v1/sources/weibo");
        expect(getSourceMetadataItemCacheKey("weibo" as SourceID)).toEqual(["source-metadata-item", "weibo"]);
        expect(getSourceItemsPath("weibo" as SourceID)).toBe("/v1/sources/weibo/items");
        expect(
            getNewsInsightsCacheKey({
                sources: ["weibo", "v2ex"] as SourceID[],
                hotLimit: 10,
                readUrls: ["https://b.example.com", "https://a.example.com"],
                hiddenUrls: ["https://hidden-b.example.com", "https://hidden-a.example.com"],
            })
        ).toEqual([
            "news-insights",
            ["v2ex", "weibo"],
            10,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            ["https://a.example.com", "https://b.example.com"],
            ["https://hidden-a.example.com", "https://hidden-b.example.com"],
        ]);
        expect(
            getNewsInsightsCacheKey({
                sources: ["weibo"] as SourceID[],
                trendLimit: 8,
                trendWindow: "7d",
            })
        ).toEqual(["news-insights", ["weibo"], undefined, undefined, undefined, 8, "7d", undefined, [], []]);
        expect(getUnifiedFeedCacheKey({ sources: ["weibo", "ithome"] as SourceID[], since: 1 })).toEqual([
            "unified-feed",
            ["ithome", "weibo"],
            1,
        ]);
        expect(sourceHealthCacheKey).toEqual(["source-health"]);
        expect(sourceMetadataCacheKey).toEqual(["source-metadata"]);
        expect(deploymentHealthCacheKey).toEqual(["deployment-health"]);
        expect(getSourceItemsV1CacheKey("weibo" as SourceID, { limit: 20, since: 1 })).toEqual([
            "source-items-v1",
            "weibo",
            undefined,
            undefined,
            1,
            20,
        ]);
        expect(getSourceItemsV1CacheKey("weibo" as SourceID, { clearCache: true, limit: 20 })).toEqual([
            "source-items-v1",
            "weibo",
            undefined,
            true,
            undefined,
            20,
        ]);
    });

    it("builds stable insights request keys for equivalent payloads", () => {
        expect(
            getNewsInsightsRequestKey({
                sources: ["weibo", "v2ex"] as SourceID[],
                readUrls: ["https://b.example.com", "https://a.example.com"],
                hiddenUrls: ["https://hidden-b.example.com", "https://hidden-a.example.com"],
            })
        ).toBe(
            getNewsInsightsRequestKey({
                sources: ["v2ex", "weibo"] as SourceID[],
                readUrls: ["https://a.example.com", "https://b.example.com"],
                hiddenUrls: ["https://hidden-a.example.com", "https://hidden-b.example.com"],
            })
        );
    });

    it("builds bearer auth headers only when a token exists", () => {
        expect(createBearerHeaders("token")).toEqual({ Authorization: "Bearer token" });
        expect(createBearerHeaders("")).toBeUndefined();
        expect(createBearerHeaders(null)).toBeUndefined();
    });
});
