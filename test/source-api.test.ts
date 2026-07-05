import type { SourceID } from "@shared/types";

import { it, expect, describe } from "vitest";

import {
    sourceApi,
    getSourceCacheKey,
    createBearerHeaders,
    sourceHealthCacheKey,
    getEntireSourcesCacheKey,
} from "../shared/source-api";

describe("source API contract", () => {
    it("keeps source endpoints centralized", () => {
        expect(sourceApi).toEqual({
            single: "/s",
            entire: "/s/entire",
            health: "/s/health",
        });
    });

    it("builds stable source cache keys", () => {
        expect(getSourceCacheKey("weibo" as SourceID)).toEqual(["source", "weibo"]);
        expect(getEntireSourcesCacheKey(["weibo", "v2ex"] as SourceID[])).toEqual(["entire", ["v2ex", "weibo"]]);
        expect(sourceHealthCacheKey).toEqual(["source-health"]);
    });

    it("builds bearer auth headers only when a token exists", () => {
        expect(createBearerHeaders("token")).toEqual({ Authorization: "Bearer token" });
        expect(createBearerHeaders("")).toBeUndefined();
        expect(createBearerHeaders(null)).toBeUndefined();
    });
});
