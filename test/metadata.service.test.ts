import type { PrimitiveMetadata } from "@shared/types";

import { it, expect, describe } from "vitest";

import { mergePrimitiveMetadata } from "../shared/metadata-merge";

function createMetadata(data: PrimitiveMetadata["data"], updatedTime: number): PrimitiveMetadata {
    return {
        data,
        updatedTime,
        action: "manual",
    };
}

describe("mergePrimitiveMetadata", () => {
    it("keeps remote order and appends local-only sources", () => {
        const local = createMetadata(
            {
                focus: ["v2ex", "hackernews", "github-trending-today"],
                hottest: ["weibo"],
                realtime: ["jin10"],
            },
            100
        );

        const remote = createMetadata(
            {
                focus: ["github-trending-today", "v2ex"],
                hottest: ["weibo", "ithome"],
                realtime: ["jin10"],
            },
            200
        );

        const merged = mergePrimitiveMetadata(local, remote);

        expect(merged.data.focus).toEqual(["github-trending-today", "v2ex", "hackernews"]);
        expect(merged.data.hottest).toEqual(["weibo", "ithome"]);
        expect(merged.data.realtime).toEqual(["jin10"]);
    });

    it("deduplicates overlap while preserving first occurrence", () => {
        const local = createMetadata(
            {
                focus: ["v2ex", "v2ex", "hackernews"],
                hottest: ["weibo", "weibo"],
                realtime: ["jin10"],
            },
            10
        );

        const remote = createMetadata(
            {
                focus: ["v2ex", "github-trending-today", "v2ex"],
                hottest: ["weibo"],
                realtime: ["jin10", "jin10"],
            },
            20
        );

        const merged = mergePrimitiveMetadata(local, remote);

        expect(merged.data.focus).toEqual(["v2ex", "github-trending-today", "hackernews"]);
        expect(merged.data.hottest).toEqual(["weibo"]);
        expect(merged.data.realtime).toEqual(["jin10"]);
    });

    it("uses latest updatedTime and marks action as sync", () => {
        const local = createMetadata(
            {
                focus: ["v2ex"],
                hottest: [],
                realtime: [],
            },
            300
        );

        const remote = createMetadata(
            {
                focus: ["github-trending-today"],
                hottest: [],
                realtime: [],
            },
            200
        );

        const merged = mergePrimitiveMetadata(local, remote);

        expect(merged.updatedTime).toBe(300);
        expect(merged.action).toBe("sync");
    });
});
