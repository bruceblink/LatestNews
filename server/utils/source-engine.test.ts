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
        const adapter = {
            descriptor: { id: sourceId, kind: "configured" as const },
            collect: vi.fn(async () => createItems()),
        };
        const engine = createSourceEngine({
            adapters: [adapter],
            onSuccess,
            onQuality,
            onFailure,
            now: () => 1_000,
        });

        await expect(engine.collect(sourceId)).resolves.toMatchObject([
            { id: "one", title: "First", url: "https://example.test/story/1" },
        ]);
        expect(engine.hasSource(sourceId)).toBe(true);
        expect(engine.listDescriptors()).toEqual([adapter.descriptor]);
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
});
