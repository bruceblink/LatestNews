import type { SourceID } from "@shared/types";

import { it, expect, describe } from "vitest";

import {
    sourceApi,
    getSourceCacheKey,
    createBearerHeaders,
    sourceHealthCacheKey,
    getNewsInsightsCacheKey,
    getEntireSourcesCacheKey,
} from "../shared/source-api";

describe("source API contract", () => {
    it("keeps source endpoints centralized", () => {
        expect(sourceApi).toEqual({
            single: "/s",
            entire: "/s/entire",
            health: "/s/health",
            insights: "/s/insights",
        });
    });

    it("builds stable source cache keys", () => {
        expect(getSourceCacheKey("weibo" as SourceID)).toEqual(["source", "weibo"]);
        expect(getEntireSourcesCacheKey(["weibo", "v2ex"] as SourceID[])).toEqual(["entire", ["v2ex", "weibo"]]);
        expect(
            getNewsInsightsCacheKey({
                sources: ["weibo", "v2ex"] as SourceID[],
                hotLimit: 10,
                readUrls: ["https://b.example.com", "https://a.example.com"],
            })
        ).toEqual([
            "news-insights",
            ["v2ex", "weibo"],
            10,
            undefined,
            undefined,
            undefined,
            ["https://a.example.com", "https://b.example.com"],
        ]);
        expect(sourceHealthCacheKey).toEqual(["source-health"]);
    });

    it("builds bearer auth headers only when a token exists", () => {
        expect(createBearerHeaders("token")).toEqual({ Authorization: "Bearer token" });
        expect(createBearerHeaders("")).toBeUndefined();
        expect(createBearerHeaders(null)).toBeUndefined();
    });
});
