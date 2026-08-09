import { it, vi, expect, describe, afterEach } from "vitest";

import { SyncHubUploadQueue } from "../shared/synchub-upload-queue";

afterEach(() => {
    vi.useRealTimers();
});

describe("SyncHub upload queue", () => {
    it("debounces consecutive changes into one ordered upload batch", async () => {
        vi.useFakeTimers();
        const run = vi.fn(async () => ({ failed: [] }));
        const queue = new SyncHubUploadQueue({
            debounceMs: 300,
            run,
            onQueued: () => undefined,
            onStart: () => undefined,
            onResult: () => undefined,
        });

        queue.enqueue(["preferences"]);
        queue.enqueue(["favorites", "reading-history"]);
        await vi.advanceTimersByTimeAsync(299);
        expect(run).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1);
        expect(run).toHaveBeenCalledTimes(1);
        expect(run).toHaveBeenCalledWith(["reading-history", "favorites", "preferences"], "auto-upload");
        queue.dispose();
    });

    it("retains a failed collection and includes it in a later retry", async () => {
        vi.useFakeTimers();
        const run = vi
            .fn()
            .mockResolvedValueOnce({ failed: ["favorites"], error: new Error("timeout") })
            .mockResolvedValueOnce({ failed: [] });
        const results: Array<{ failed: string[]; pendingCollections: string[] }> = [];
        const queue = new SyncHubUploadQueue({
            debounceMs: 300,
            run,
            onQueued: () => undefined,
            onStart: () => undefined,
            onResult: (result) => results.push(result),
        });

        queue.enqueue(["reading-history", "favorites"], "auto-upload", 0);
        await vi.advanceTimersByTimeAsync(0);
        expect(results[0]).toMatchObject({ failed: ["favorites"], pendingCollections: ["favorites"] });

        queue.enqueue(["preferences"], "retry-upload", 0);
        await vi.advanceTimersByTimeAsync(0);
        expect(run).toHaveBeenLastCalledWith(["favorites", "preferences"], "retry-upload");
        queue.dispose();
    });

    it("schedules data changed during an upload for the next batch", async () => {
        vi.useFakeTimers();
        let resolveFirstUpload: ((value: { failed: [] }) => void) | undefined;
        const run = vi.fn(
            () =>
                new Promise<{ failed: [] }>((resolve) => {
                    resolveFirstUpload = resolve;
                })
        );
        const queue = new SyncHubUploadQueue({
            debounceMs: 300,
            run,
            onQueued: () => undefined,
            onStart: () => undefined,
            onResult: () => undefined,
        });

        queue.enqueue(["reading-history"], "auto-upload", 0);
        await vi.advanceTimersByTimeAsync(0);
        queue.enqueue(["favorites"]);
        resolveFirstUpload?.({ failed: [] });
        await vi.advanceTimersByTimeAsync(300);

        expect(run).toHaveBeenNthCalledWith(1, ["reading-history"], "auto-upload");
        expect(run).toHaveBeenNthCalledWith(2, ["favorites"], "auto-upload");
        queue.dispose();
    });

    it("clears queued timers when the hook unmounts", async () => {
        vi.useFakeTimers();
        const run = vi.fn(async () => ({ failed: [] }));
        const queue = new SyncHubUploadQueue({
            debounceMs: 300,
            run,
            onQueued: () => undefined,
            onStart: () => undefined,
            onResult: () => undefined,
        });

        queue.enqueue(["favorites"]);
        queue.dispose();
        await vi.advanceTimersByTimeAsync(300);

        expect(run).not.toHaveBeenCalled();
    });
});
