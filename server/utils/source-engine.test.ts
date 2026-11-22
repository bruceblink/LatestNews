import type { SourceID, NewsItem } from "@shared/types";

import { it, vi, expect, describe } from "vitest";

import { createSourceEngine } from "./source-engine";

const sourceId = "engine-test" as SourceID;

function createItems(): NewsItem[] {
    return [
        { id: "one", title: "  First  ", url: "https://example.test/story/1" },
        { id: "duplicate", title: "Duplicate", url: "https://example.test/story/1" },
    ];
}

describe("createSourceEngine", () => {
    it("registers adapters, lists descriptors, and normalizes output", async () => {
        const onSuccess = vi.fn();
        const onQuality = vi.fn();
        const onFailure = vi.fn();
        const onAdapter = vi.fn();
        const adapter = {
            descriptor: { id: sourceId, kind: "configured" as const },
            collect: vi.fn(async () => createItems()),
        };
        const engine = createSourceEngine({
            adapters: [adapter],
            onSuccess,
            onQuality,
            onFailure,
            onAdapter,
            now: () => 1_000,
        });

        await expect(engine.collect(sourceId)).resolves.toMatchObject([
            { id: "one", title: "First", url: "https://example.test/story/1" },
        ]);
        expect(engine.hasSource(sourceId)).toBe(true);
        expect(engine.listDescriptors()).toEqual([adapter.descriptor]);
        expect(onAdapter).toHaveBeenCalledWith(sourceId, adapter.descriptor);
        expect(adapter.collect).toHaveBeenCalledTimes(1);
        expect(onSuccess).toHaveBeenCalledWith(sourceId, 0, 1);
        expect(onQuality).toHaveBeenCalledWith(
            sourceId,
            expect.objectContaining({ rawItemCount: 2, validItemCount: 1, duplicateItemCount: 1 }),
            1_000
        );
        expect(onFailure).not.toHaveBeenCalled();
    });

    it("merges concurrent collection requests for the same source", async () => {
        let release: (items: NewsItem[]) => void = () => undefined;
        const collect = vi.fn(
            () =>
                new Promise<NewsItem[]>((resolve) => {
                    release = resolve;
                })
        );
        const engine = createSourceEngine({
            adapters: [{ descriptor: { id: sourceId, kind: "legacy" }, collect }],
            onSuccess: vi.fn(),
            onFailure: vi.fn(),
        });

        const first = engine.collect(sourceId);
        const second = engine.collect(sourceId);
        await Promise.resolve();
        release(createItems());

        await expect(Promise.all([first, second])).resolves.toMatchObject([
            [{ id: "one", title: "First" }],
            [{ id: "one", title: "First" }],
        ]);
        expect(collect).toHaveBeenCalledTimes(1);
    });

    it("cancels callers independently and keeps collection alive for a cache fill", async () => {
        const output = Promise.withResolvers<NewsItem[]>();
        const onSuccess = vi.fn();
        const onFailure = vi.fn();
        const collect = vi.fn(({ signal }: { signal: AbortSignal }) => {
            expect(signal.aborted).toBe(false);
            return output.promise;
        });
        const engine = createSourceEngine({
            adapters: [{ descriptor: { id: sourceId, kind: "legacy" }, collect }],
            onSuccess,
            onFailure,
        });
        const first = new AbortController();
        const second = new AbortController();
        const cancelledFirst = expect(engine.collect(sourceId, { signal: first.signal })).rejects.toMatchObject({
            code: "CANCELLED",
        });
        const cancelledSecond = expect(engine.collect(sourceId, { signal: second.signal })).rejects.toMatchObject({
            code: "CANCELLED",
        });
        const cacheFill = engine.collect(sourceId);
        await Promise.resolve();
        first.abort();
        second.abort();

        await Promise.all([cancelledFirst, cancelledSecond]);
        expect(collect.mock.calls[0]?.[0].signal.aborted).toBe(false);
        output.resolve(createItems());
        await expect(cacheFill).resolves.toHaveLength(1);
        expect(collect).toHaveBeenCalledOnce();
        expect(onSuccess).toHaveBeenCalledOnce();
        expect(onFailure).not.toHaveBeenCalled();
    });

    it("aborts an active adapter when the final caller leaves and starts a new collection on retry", async () => {
        const started = Promise.withResolvers<AbortSignal>();
        const onSuccess = vi.fn();
        const onFailure = vi.fn();
        const collect = vi
            .fn<({ signal }: { signal: AbortSignal }) => Promise<NewsItem[]>>()
            .mockImplementationOnce(({ signal }) => {
                started.resolve(signal);
                return new Promise((resolve) => {
                    // Even an adapter that returns data while aborting must not report it as success.
                    signal.addEventListener("abort", () => resolve(createItems()), { once: true });
                });
            })
            .mockResolvedValueOnce(createItems());
        const engine = createSourceEngine({
            adapters: [{ descriptor: { id: sourceId, kind: "configured" }, collect }],
            onSuccess,
            onFailure,
        });
        const first = new AbortController();
        const second = new AbortController();
        const cancelledFirst = expect(engine.collect(sourceId, { signal: first.signal })).rejects.toMatchObject({
            code: "CANCELLED",
        });
        const cancelledSecond = expect(engine.collect(sourceId, { signal: second.signal })).rejects.toMatchObject({
            code: "CANCELLED",
        });
        const adapterSignal = await started.promise;

        first.abort();
        await cancelledFirst;
        expect(adapterSignal.aborted).toBe(false);
        second.abort();
        const retry = engine.collect(sourceId);
        await cancelledSecond;
        expect(adapterSignal.aborted).toBe(true);
        await expect(retry).resolves.toHaveLength(1);
        expect(collect).toHaveBeenCalledTimes(2);
        expect(onSuccess).toHaveBeenCalledOnce();
        expect(onFailure).not.toHaveBeenCalled();
    });

    it("stops active and queued collection on close", async () => {
        const queuedId = "engine-queued" as SourceID;
        const active = Promise.withResolvers<AbortSignal>();
        const queuedCollect = vi.fn(async () => createItems());
        const onFailure = vi.fn();
        const engine = createSourceEngine({
            adapters: [
                {
                    descriptor: { id: sourceId, kind: "plugin" },
                    collect: ({ signal }) =>
                        new Promise((resolve) => {
                            active.resolve(signal);
                            signal.addEventListener("abort", () => resolve([]), { once: true });
                        }),
                },
                { descriptor: { id: queuedId, kind: "plugin" }, collect: queuedCollect },
            ],
            maxConcurrent: 1,
            onSuccess: vi.fn(),
            onFailure,
        });
        const running = expect(engine.collect(sourceId)).rejects.toMatchObject({ code: "CANCELLED" });
        const queued = expect(engine.collect(queuedId)).rejects.toMatchObject({ code: "CANCELLED" });
        const signal = await active.promise;

        engine.close();

        await Promise.all([running, queued]);
        expect(signal.aborted).toBe(true);
        expect(queuedCollect).not.toHaveBeenCalled();
        expect(onFailure).not.toHaveBeenCalled();
        await expect(engine.collect(queuedId)).rejects.toMatchObject({ code: "CANCELLED" });
    });

    it("rejects duplicate adapter IDs", () => {
        const engine = createSourceEngine({
            adapters: [{ descriptor: { id: sourceId, kind: "legacy" }, collect: async () => [] }],
            onSuccess: vi.fn(),
            onFailure: vi.fn(),
        });

        expect(() =>
            engine.register({ descriptor: { id: sourceId, kind: "plugin" }, collect: async () => [] })
        ).toThrow(`Source ${sourceId} is already registered.`);
    });

    it("cancels queued work before it reaches an adapter", async () => {
        let release: (items: NewsItem[]) => void = () => undefined;
        const queuedId = "engine-queued" as SourceID;
        const engine = createSourceEngine({
            adapters: [
                {
                    descriptor: { id: sourceId, kind: "legacy" },
                    collect: () => new Promise<NewsItem[]>((resolve) => (release = resolve)),
                },
                {
                    descriptor: { id: queuedId, kind: "configured" },
                    collect: vi.fn(async () => createItems()),
                },
            ],
            maxConcurrent: 1,
            maxQueued: 1,
            queueTimeoutMs: 100,
            onSuccess: vi.fn(),
            onFailure: vi.fn(),
        });

        const running = engine.collect(sourceId);
        await Promise.resolve();
        const controller = new AbortController();
        const queued = engine.collect(queuedId, { signal: controller.signal });
        controller.abort();

        await expect(queued).rejects.toMatchObject({ code: "CANCELLED" });
        release(createItems());
        await expect(running).resolves.toHaveLength(1);
    });
});
