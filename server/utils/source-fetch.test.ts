import type { NewsItem, SourceID } from "@shared/types";

import { it, vi, expect, describe } from "vitest";

vi.mock("#/getters", () => ({
    getters: {},
}));

import { createSourceFetcher } from "./source-fetch";

function createItems(count: number): NewsItem[] {
    return Array.from({ length: count }, (_, index) => ({
        id: index,
        title: `title ${index}`,
        url: `https://example.com/${index}`,
    }));
}

describe("createSourceFetcher", () => {
    it("deduplicates concurrent fetches for the same source", async () => {
        let resolveItems: (items: NewsItem[]) => void = () => undefined;
        const getItems = vi.fn(
            () =>
                new Promise<NewsItem[]>((resolve) => {
                    resolveItems = resolve;
                })
        );
        const onSuccess = vi.fn();
        const onFailure = vi.fn();
        const fetchSourceItems = createSourceFetcher({
            getItems,
            onSuccess,
            onFailure,
            now: () => 1_000,
        });

        const first = fetchSourceItems("weibo" as SourceID);
        const second = fetchSourceItems("weibo" as SourceID);

        resolveItems(createItems(2));

        await expect(Promise.all([first, second])).resolves.toEqual([createItems(2), createItems(2)]);
        expect(getItems).toHaveBeenCalledTimes(1);
        expect(onSuccess).toHaveBeenCalledWith("weibo", 0, 2);
        expect(onFailure).not.toHaveBeenCalled();
    });

    it("caps normalized source items before recording success", async () => {
        const onSuccess = vi.fn();
        const fetchSourceItems = createSourceFetcher({
            getItems: async () => createItems(35),
            onSuccess,
            onFailure: vi.fn(),
            now: () => 1_000,
        });

        const result = await fetchSourceItems("weibo" as SourceID);

        expect(result).toHaveLength(30);
        expect(onSuccess).toHaveBeenCalledWith("weibo", 0, 30);
    });

    it("filters invalid source items, deduplicates URLs, and backfills stable ids", async () => {
        const onSuccess = vi.fn();
        const fetchSourceItems = createSourceFetcher({
            getItems: async () =>
                [
                    {
                        id: "",
                        title: "  First title  ",
                        url: "https://example.com/news/1?utm_source=feed",
                        pubDate: "2026-07-05T08:00:00.000Z",
                    },
                    {
                        id: "duplicate",
                        title: "Duplicate title",
                        url: "https://example.com/news/1",
                    },
                    {
                        id: "missing-title",
                        title: "",
                        url: "https://example.com/news/2",
                    },
                    {
                        id: "missing-url",
                        title: "Missing URL",
                        url: "",
                    },
                ] as NewsItem[],
            onSuccess,
            onFailure: vi.fn(),
            now: () => 1_000,
        });

        const result = await fetchSourceItems("weibo" as SourceID);

        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({
            id: expect.stringMatching(/^weibo:url-/),
            title: "First title",
            url: "https://example.com/news/1?utm_source=feed",
            pubDate: Date.parse("2026-07-05T08:00:00.000Z"),
        });
        expect(onSuccess).toHaveBeenCalledWith("weibo", 0, 1);
    });

    it("clears in-flight state after a failed fetch", async () => {
        const onFailure = vi.fn();
        const getItems = vi
            .fn<() => Promise<NewsItem[]>>()
            .mockRejectedValueOnce(new Error("temporary failure"))
            .mockResolvedValueOnce(createItems(1));
        const fetchSourceItems = createSourceFetcher({
            getItems,
            onSuccess: vi.fn(),
            onFailure,
            now: () => 1_000,
        });

        await expect(fetchSourceItems("weibo" as SourceID)).rejects.toThrow("temporary failure");
        await expect(fetchSourceItems("weibo" as SourceID)).resolves.toHaveLength(1);

        expect(getItems).toHaveBeenCalledTimes(2);
        expect(onFailure).toHaveBeenCalledTimes(1);
    });
});
