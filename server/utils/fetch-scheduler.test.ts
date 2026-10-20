import { it, expect, describe } from "vitest";

import { createFetchScheduler } from "./fetch-scheduler";

describe("fetch scheduler", () => {
    it("limits total and per-key concurrency while preserving fair progress", async () => {
        const releases = [createDeferred<number>(), createDeferred<number>(), createDeferred<number>()];
        const scheduler = createFetchScheduler({
            maxConcurrent: 2,
            maxPerKey: 1,
            maxQueued: 2,
            queueTimeoutMs: 100,
            taskTimeoutMs: 100,
        });
        const first = scheduler.run("same", () => releases[0]!.promise);
        const second = scheduler.run("same", () => releases[1]!.promise);
        const third = scheduler.run("other", () => releases[2]!.promise);

        await Promise.resolve();
        expect(scheduler.activeCount).toBe(2);
        expect(scheduler.queuedCount).toBe(1);
        expect(scheduler.activeKeys).toEqual(
            new Map([
                ["same", 1],
                ["other", 1],
            ])
        );

        releases[2]!.resolve(3);
        await expect(third).resolves.toBe(3);
        releases[0]!.resolve(1);
        await expect(first).resolves.toBe(1);
        releases[1]!.resolve(2);
        await expect(second).resolves.toBe(2);
        expect(scheduler.activeCount).toBe(0);
    });

    it("rejects overflow and queue wait timeout", async () => {
        const release = createDeferred<void>();
        const scheduler = createFetchScheduler({
            maxConcurrent: 1,
            maxPerKey: 1,
            maxQueued: 1,
            queueTimeoutMs: 10,
            taskTimeoutMs: 100,
        });
        const running = scheduler.run("same", () => release.promise);
        const waiting = scheduler.run("same", async () => undefined);
        const overflow = scheduler.run("same", async () => undefined);

        await expect(overflow).rejects.toMatchObject({ code: "QUEUE_FULL" });
        await expect(waiting).rejects.toMatchObject({ code: "TIMEOUT" });
        release.resolve();
        await expect(running).resolves.toBeUndefined();
    });

    it("aborts a running task when its execution deadline expires", async () => {
        const scheduler = createFetchScheduler({
            maxConcurrent: 1,
            maxPerKey: 1,
            maxQueued: 1,
            queueTimeoutMs: 100,
            taskTimeoutMs: 10,
        });
        let aborted = false;
        const result = scheduler.run(
            "same",
            (signal) =>
                new Promise<void>((resolve) => {
                    signal.addEventListener("abort", () => {
                        aborted = true;
                        resolve();
                    });
                })
        );

        await expect(result).rejects.toMatchObject({ code: "TIMEOUT" });
        expect(aborted).toBe(true);
        expect(scheduler.activeCount).toBe(0);
    });

    it("cancels queued work from the caller signal", async () => {
        const release = createDeferred<void>();
        const controller = new AbortController();
        const scheduler = createFetchScheduler({
            maxConcurrent: 1,
            maxPerKey: 1,
            maxQueued: 1,
            queueTimeoutMs: 100,
            taskTimeoutMs: 100,
        });
        const running = scheduler.run("same", () => release.promise);
        const waiting = scheduler.run("same", async () => undefined, controller.signal);
        controller.abort();

        await expect(waiting).rejects.toMatchObject({ code: "CANCELLED" });
        release.resolve();
        await expect(running).resolves.toBeUndefined();
        expect(scheduler.queuedCount).toBe(0);
    });
});

function createDeferred<T>() {
    let resolve: (value: T) => void = () => undefined;
    const promise = new Promise<T>((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}
