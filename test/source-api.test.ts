import type { SourceID } from "@shared/types";

import { it, expect, describe } from "vitest";

import {
    sourceApi,
    getSourceCacheKey,
    getSourceItemsPath,
    createBearerHeaders,
    sourceHealthCacheKey,
    sourceMetadataCacheKey,
    getUnifiedFeedCacheKey,
    getNewsInsightsCacheKey,
    isEntireSourcesResponse,
    deploymentHealthCacheKey,
    getSourceItemsV1CacheKey,
    getEntireSourcesCacheKey,
    getNewsInsightsRequestKey,
    normalizeEntireSourcesResponse,
} from "../shared/source-api";

describe("source API contract", () => {
    it("keeps source endpoints centralized", () => {
        expect(sourceApi).toEqual({
            single: "/s",
            entire: "/s/entire",
            health: "/s/health",
            insights: "/s/insights",
            nodeV1: "/v1/node",
            sourcesV1: "/v1/sources",
            sourceBatchV1: "/v1/sources/batch",
            sourceHealthV1: "/v1/health/sources",
            deploymentHealthV1: "/v1/health/deployment",
            sourceHealthDiagnosticsV1: "/v1/health/diagnostics",
            jsonFeedV1: "/v1/feeds/json",
            rssFeedV1: "/v1/feeds/rss",
        });
    });

    it("builds stable source cache keys", () => {
        expect(getSourceCacheKey("weibo" as SourceID)).toEqual(["source", "weibo"]);
        expect(getSourceItemsPath("weibo" as SourceID)).toBe("/v1/sources/weibo/items");
        expect(getEntireSourcesCacheKey(["weibo", "v2ex"] as SourceID[])).toEqual(["entire", ["v2ex", "weibo"]]);
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
            ["https://a.example.com", "https://b.example.com"],
            ["https://hidden-a.example.com", "https://hidden-b.example.com"],
        ]);
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

    it("normalizes entire source envelope responses", () => {
        const item = {
            status: "success" as const,
            id: "weibo" as SourceID,
            updatedTime: 1,
            items: [],
        };
        const envelope = {
            data: [item],
            meta: {
                generatedAt: 1,
                requestedSourceCount: 1,
                resolvedSourceCount: 1,
                partial: false,
                omittedSourceIds: [],
            },
            errors: [],
        };

        expect(isEntireSourcesResponse(envelope)).toBe(true);
        expect(normalizeEntireSourcesResponse(envelope)).toEqual([item]);
        expect(normalizeEntireSourcesResponse([item])).toEqual([item]);
        expect(normalizeEntireSourcesResponse(undefined)).toBeUndefined();
    });
});
