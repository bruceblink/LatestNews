import { it, vi, expect, describe, afterEach } from "vitest";

import { createDesktopBackgroundRefresh } from "../electron/background-refresh";

describe("desktop background refresh", () => {
    afterEach(() => vi.useRealTimers());

    it("refreshes due sources at their own intervals", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-10-25T00:00:00Z"));
        const refreshSource = vi.fn(async (_sourceId: string) => undefined);
        const scheduler = createDesktopBackgroundRefresh({
            listSources: () => [
                { id: "fast", interval: 30_000 },
                { id: "slow", interval: 60_000 },
            ],
            refreshSource,
        });

        scheduler.start();
        await vi.advanceTimersByTimeAsync(0);
        expect(refreshSource.mock.calls.map(([sourceId]) => sourceId)).toEqual(["fast", "slow"]);

        await vi.advanceTimersByTimeAsync(30_000);
        expect(refreshSource.mock.calls.map(([sourceId]) => sourceId)).toEqual(["fast", "slow", "fast"]);

        await vi.advanceTimersByTimeAsync(30_000);
        expect(refreshSource.mock.calls.map(([sourceId]) => sourceId)).toEqual([
            "fast",
            "slow",
            "fast",
            "fast",
            "slow",
        ]);
        scheduler.dispose();
    });

    it("pauses while visible and refreshes each overdue source once after resume", async () => {
        vi.useFakeTimers();
        const refreshSource = vi.fn(async (_sourceId: string) => undefined);
        const scheduler = createDesktopBackgroundRefresh({
            listSources: () => [{ id: "hackernews", interval: 30_000 }],
            refreshSource,
        });

        scheduler.start();
        await vi.advanceTimersByTimeAsync(0);
        scheduler.pause("window-visible");
        await vi.advanceTimersByTimeAsync(5 * 60_000);
        expect(refreshSource).toHaveBeenCalledTimes(1);

        scheduler.resume("window-visible");
        await vi.advanceTimersByTimeAsync(0);
        expect(refreshSource).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(29_999);
        expect(refreshSource).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(1);
        expect(refreshSource).toHaveBeenCalledTimes(3);
        scheduler.dispose();
    });

    it("waits one source interval before retrying a failed refresh", async () => {
        vi.useFakeTimers();
        const refreshSource = vi.fn(async (_sourceId: string) => {
            throw new Error("upstream failure");
        });
        const onError = vi.fn();
        const scheduler = createDesktopBackgroundRefresh({
            listSources: () => [{ id: "freebuf", interval: 60_000 }],
            refreshSource,
            onError,
        });

        scheduler.start();
        await vi.advanceTimersByTimeAsync(0);
        expect(refreshSource).toHaveBeenCalledTimes(1);
        expect(onError).toHaveBeenCalledWith("freebuf", expect.any(Error));

        await vi.advanceTimersByTimeAsync(59_999);
        expect(refreshSource).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(refreshSource).toHaveBeenCalledTimes(2);
        scheduler.dispose();
    });

    it("limits concurrent refreshes to the provider's two execution slots", async () => {
        vi.useFakeTimers();
        let active = 0;
        let maximumActive = 0;
        const refreshSource = vi.fn(async (_sourceId: string) => {
            active += 1;
            maximumActive = Math.max(maximumActive, active);
            await new Promise<void>((resolve) => setTimeout(resolve, 10));
            active -= 1;
        });
        const scheduler = createDesktopBackgroundRefresh({
            listSources: () => ["a", "b", "c", "d", "e"].map((id) => ({ id, interval: 30_000 })),
            refreshSource,
        });

        scheduler.start();
        await vi.advanceTimersByTimeAsync(100);
        expect(refreshSource).toHaveBeenCalledTimes(5);
        expect(maximumActive).toBe(2);
        scheduler.dispose();
    });

    it("does not start a due timer loop while a manual refresh is running", async () => {
        vi.useFakeTimers();
        let finishRefresh!: () => void;
        const refreshGate = new Promise<void>((resolve) => {
            finishRefresh = resolve;
        });
        const refreshSource = vi.fn(async (_sourceId: string) => refreshGate);
        const scheduler = createDesktopBackgroundRefresh({
            listSources: () => [{ id: "hackernews", interval: 30_000 }],
            refreshSource,
        });

        scheduler.start();
        const manualRefresh = scheduler.refreshNow();
        await Promise.resolve();
        expect(refreshSource).toHaveBeenCalledOnce();

        await vi.advanceTimersByTimeAsync(60_000);
        expect(refreshSource).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);

        finishRefresh();
        await manualRefresh;
        expect(vi.getTimerCount()).toBe(1);
        scheduler.dispose();
    });

    it("does not schedule while the selected collection mode blocks local refresh", async () => {
        vi.useFakeTimers();
        let canRefresh = false;
        const refreshSource = vi.fn(async (_sourceId: string) => undefined);
        const scheduler = createDesktopBackgroundRefresh({
            listSources: () => [{ id: "juejin", interval: 30_000 }],
            refreshSource,
            canRefresh: () => canRefresh,
        });

        scheduler.start();
        await vi.advanceTimersByTimeAsync(60_000);
        expect(refreshSource).not.toHaveBeenCalled();

        canRefresh = true;
        scheduler.start();
        await vi.advanceTimersByTimeAsync(0);
        expect(refreshSource).toHaveBeenCalledOnce();
        scheduler.dispose();
    });

    it("stops timers and refresh work after disposal", async () => {
        vi.useFakeTimers();
        const refreshSource = vi.fn(async (_sourceId: string) => undefined);
        const scheduler = createDesktopBackgroundRefresh({
            listSources: () => [{ id: "pcbeta-windows11", interval: 30_000 }],
            refreshSource,
        });

        scheduler.start();
        await vi.advanceTimersByTimeAsync(0);
        scheduler.dispose();
        await vi.advanceTimersByTimeAsync(24 * 60 * 60_000);

        expect(refreshSource).toHaveBeenCalledOnce();
        expect(scheduler.snapshot()).toMatchObject({ enabled: false, paused: false, running: false });
    });

    it.each(["window-visible", "system-suspend", "remote-mode"])(
        "does not start queued background sources after %s",
        async (reason) => {
            vi.useFakeTimers();
            let finishBatch!: () => void;
            const gate = new Promise<void>((resolve) => {
                finishBatch = resolve;
            });
            let canRefresh = true;
            const refreshSource = vi.fn(async (_sourceId: string) => gate);
            const scheduler = createDesktopBackgroundRefresh({
                listSources: () => ["a", "b", "c", "d"].map((id) => ({ id, interval: 30_000 })),
                refreshSource,
                canRefresh: () => canRefresh,
            });
            scheduler.start();
            await vi.advanceTimersByTimeAsync(0);
            expect(refreshSource).toHaveBeenCalledTimes(2);
            if (reason === "remote-mode") canRefresh = false;
            else scheduler.pause(reason);
            finishBatch();
            await vi.waitFor(() => expect(scheduler.snapshot().running).toBe(false));
            expect(refreshSource).toHaveBeenCalledTimes(2);
            canRefresh = true;
            if (reason === "remote-mode") scheduler.start();
            else scheduler.resume(reason);
            await vi.advanceTimersByTimeAsync(0);
            expect(refreshSource.mock.calls.map(([id]) => id)).toEqual(["a", "b", "c", "d"]);
            scheduler.dispose();
        }
    );

    it("does not start another batch after the scheduler stops", async () => {
        vi.useFakeTimers();
        let finishBatch!: () => void;
        const batchGate = new Promise<void>((resolve) => {
            finishBatch = resolve;
        });
        const refreshSource = vi.fn(async (_sourceId: string) => batchGate);
        const scheduler = createDesktopBackgroundRefresh({
            listSources: () => ["a", "b", "c", "d"].map((id) => ({ id, interval: 30_000 })),
            refreshSource,
        });

        scheduler.start();
        await vi.advanceTimersByTimeAsync(0);
        expect(refreshSource).toHaveBeenCalledTimes(2);

        scheduler.stop();
        finishBatch();
        await vi.waitFor(() => expect(scheduler.snapshot().running).toBe(false));
        expect(refreshSource).toHaveBeenCalledTimes(2);
        scheduler.dispose();
    });
});
