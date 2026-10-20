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

function createDeferred<T>() {
    let resolve: (value: T) => void = () => undefined;
    const promise = new Promise<T>((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
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

        await Promise.resolve();
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

    it("bounds source collection concurrency and rejects an overfull queue", async () => {
        const releases = [createDeferred<NewsItem[]>(), createDeferred<NewsItem[]>()];
        const getItems = vi
            .fn<(_: SourceID) => Promise<NewsItem[]>>()
            .mockImplementationOnce(() => releases[0]!.promise)
            .mockImplementationOnce(() => releases[1]!.promise);
        const onFailure = vi.fn();
        const fetchSourceItems = createSourceFetcher({
            getItems,
            onSuccess: vi.fn(),
            onFailure,
            maxConcurrent: 1,
            maxQueued: 0,
            queueTimeoutMs: 20,
            now: () => 1_000,
        });

        const first = fetchSourceItems("weibo" as SourceID);
        const second = fetchSourceItems("zhihu" as SourceID);
        await Promise.resolve();
        releases[0]!.resolve(createItems(1));

        await expect(first).resolves.toHaveLength(1);
        await expect(second).rejects.toMatchObject({ code: "QUEUE_FULL" });
        expect(getItems).toHaveBeenCalledTimes(1);
        expect(onFailure).toHaveBeenCalledWith("zhihu", 0, expect.objectContaining({ code: "QUEUE_FULL" }));
    });

    it("expires a source that waits beyond the queue budget", async () => {
        const release = createDeferred<NewsItem[]>();
        const getItems = vi
            .fn<(_: SourceID) => Promise<NewsItem[]>>()
            .mockImplementationOnce(() => release.promise)
            .mockResolvedValueOnce(createItems(1));
        const fetchSourceItems = createSourceFetcher({
            getItems,
            onSuccess: vi.fn(),
            onFailure: vi.fn(),
            maxConcurrent: 1,
            maxQueued: 1,
            queueTimeoutMs: 10,
            now: () => 1_000,
        });

        const running = fetchSourceItems("weibo" as SourceID);
        const waiting = fetchSourceItems("zhihu" as SourceID);
        await expect(waiting).rejects.toMatchObject({ code: "TIMEOUT" });

        release.resolve(createItems(1));
        await expect(running).resolves.toHaveLength(1);
        expect(getItems).toHaveBeenCalledTimes(1);
    });
});
