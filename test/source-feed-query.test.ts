import { it, expect, describe } from "vitest";

import {
    getFeedTitle,
    getMaxFeedItems,
    getFeedDescription,
    sourceFeedQuerySchema,
    hasSourceFeedSelector,
    createSourceFeedPayload,
} from "../server/utils/source-feed-query";

describe("source feed query", () => {
    it("creates a source batch payload from feed query aliases", () => {
        const parsed = sourceFeedQuerySchema.parse({
            column: ["finance", "tech"],
            limit: "10",
            q: "weibo",
            since: "2026-07-05T08:00:00.000Z",
            title: ["Custom Feed", "Ignored"],
            type: "hottest",
        });

        expect(createSourceFeedPayload(parsed)).toEqual({
            column: ["finance", "tech"],
            limit: "10",
            since: "2026-07-05T08:00:00.000Z",
            source: "weibo",
            type: "hottest",
        });
        expect(getFeedTitle(parsed)).toBe("Custom Feed");
        expect(getFeedDescription(parsed)).toBe("LatestNews exported news feed");
        expect(hasSourceFeedSelector(createSourceFeedPayload(parsed))).toBe(true);
    });

    it("normalizes max feed items with a max guard", () => {
        expect(getMaxFeedItems(sourceFeedQuerySchema.parse({ maxItems: "20" }))).toBe(20);
        expect(getMaxFeedItems(sourceFeedQuerySchema.parse({ maxItems: "200" }))).toBe(100);
        expect(getMaxFeedItems(sourceFeedQuerySchema.parse({ maxItems: "bad" }))).toBeUndefined();
    });
});
