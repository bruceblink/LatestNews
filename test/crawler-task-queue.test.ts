import { it, expect, describe } from "vitest";

import { createCrawlerTaskQueue } from "../crawler-platform/host/task-queue";

describe("crawler task queue", () => {
    it("starts queued work only when an active task releases a slot", async () => {
        const queue = createCrawlerTaskQueue({ maxConcurrent: 2, maxQueued: 1, queueTimeoutMs: 1000 });
        const releases = [createDeferred<number>(), createDeferred<number>(), createDeferred<number>()];
        let running = 0;
        let peakRunning = 0;
        const runTask = (index: number) =>
            queue.run(async () => {
                running += 1;
                peakRunning = Math.max(peakRunning, running);
                try {
                    return await releases[index]!.promise;
                } finally {
                    running -= 1;
                }
            });

        const first = runTask(0);
        const second = runTask(1);
        const third = runTask(2);
        await Promise.resolve();
        expect(queue.activeCount).toBe(2);
        expect(queue.queuedCount).toBe(1);

        releases[0]!.resolve(1);
        await expect(first).resolves.toBe(1);
        await Promise.resolve();
        expect(queue.activeCount).toBe(2);
        expect(queue.queuedCount).toBe(0);

        releases[1]!.resolve(2);
        releases[2]!.resolve(3);
        await expect(Promise.all([second, third])).resolves.toEqual([2, 3]);
        expect(peakRunning).toBe(2);
        expect(queue.activeCount).toBe(0);
    });

    it("rejects overflow and expires work that waits beyond the queue budget", async () => {
        const queue = createCrawlerTaskQueue({ maxConcurrent: 1, maxQueued: 1, queueTimeoutMs: 10 });
        const release = createDeferred<void>();
        const running = queue.run(() => release.promise);
        const waiting = queue.run(async () => "started");
        const overflow = queue.run(async () => "must not start");

        await expect(overflow).rejects.toMatchObject({ code: "QUEUE_FULL" });
        await expect(waiting).rejects.toMatchObject({ code: "TIMEOUT" });
        expect(queue.queuedCount).toBe(0);
        release.resolve();
        await expect(running).resolves.toBeUndefined();
    });

    it("rejects invalid queue limits", () => {
        expect(() => createCrawlerTaskQueue({ maxConcurrent: 0, maxQueued: 0, queueTimeoutMs: 10 })).toThrow(
            RangeError
        );
        expect(() => createCrawlerTaskQueue({ maxConcurrent: 1, maxQueued: -1, queueTimeoutMs: 10 })).toThrow(
            RangeError
        );
        expect(() => createCrawlerTaskQueue({ maxConcurrent: 1, maxQueued: 1, queueTimeoutMs: 0 })).toThrow(RangeError);
    });
});

function createDeferred<T>() {
    let resolvePromise: (value: T) => void = () => undefined;
    const promise = new Promise<T>((resolve) => {
        resolvePromise = resolve;
    });
    return { promise, resolve: resolvePromise };
}
