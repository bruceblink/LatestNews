import { it, expect, describe } from "vitest";

import { createDesktopLifecycleTracker } from "../electron/lifecycle";

describe("desktop lifecycle diagnostics retention", () => {
    it("retains all active windows and only the most recently closed snapshots after 10,000 cycles", () => {
        let time = 0;
        const tracker = createDesktopLifecycleTracker({ now: () => time, maxEvents: 32, maxClosedWindows: 16 });
        tracker.registerWindow(1, "main");
        tracker.updateWindow(1, "visible", "window-show");
        tracker.registerWindow(2, "auth");
        for (let i = 3; i < 10003; i++) {
            time++;
            tracker.registerWindow(i, "auth");
            tracker.updateWindow(i, "closed", "window-closed");
            const snapshot = tracker.snapshot();
            expect(snapshot.windows.length).toBeLessThanOrEqual(18);
            expect(snapshot.events.length).toBeLessThanOrEqual(32);
        }
        const snapshot = tracker.snapshot();
        expect(snapshot.windows.filter((window) => window.state === "closed").map((window) => window.id)).toEqual(
            Array.from({ length: 16 }, (_, i) => 9987 + i)
        );
        expect(snapshot.windows.find((window) => window.id === 1)?.state).toBe("visible");
        expect(snapshot.windows.find((window) => window.id === 2)?.state).toBe("created");
        expect(snapshot.events.at(-1)?.name).toBe("window-closed");
        expect(snapshot.lastEvent?.sequence).toBe(20003);
    });

    it("evicts by close order, not creation order, and keeps a hidden live window", () => {
        const tracker = createDesktopLifecycleTracker({ maxClosedWindows: 1 });
        for (let i = 1; i <= 3; i++) tracker.registerWindow(i, "auth");
        tracker.updateWindow(3, "hidden", "window-hide");
        tracker.updateWindow(2, "closed", "window-closed");
        tracker.updateWindow(1, "closed", "window-closed");
        expect(tracker.snapshot().windows.map((window) => [window.id, window.state])).toEqual([
            [1, "closed"],
            [3, "hidden"],
        ]);
    });

    it("does not resurrect closed or evicted windows on delayed events", () => {
        let now = 0;
        const tracker = createDesktopLifecycleTracker({ maxClosedWindows: 1, now: () => now });
        tracker.registerWindow(1, "auth");
        now = 5;
        tracker.updateWindow(1, "closed", "window-closed");
        now = 8;
        tracker.updateWindow(1, "visible", "window-show");
        tracker.updateWindow(1, "closed", "window-closed");
        expect(tracker.snapshot().windows[0]).toMatchObject({ state: "closed", closedAtMs: 5 });
        tracker.registerWindow(2, "auth");
        tracker.updateWindow(2, "closed", "window-closed");
        tracker.updateWindow(1, "visible", "window-show");
        expect(tracker.snapshot().windows.map((window) => window.id)).toEqual([2]);
    });

    it("supports explicit zero retention and a newly registered ID", () => {
        const tracker = createDesktopLifecycleTracker({ maxClosedWindows: 0 });
        tracker.registerWindow(1, "auth");
        tracker.updateWindow(1, "closed", "window-closed");
        expect(tracker.snapshot().windows).toEqual([]);
        tracker.registerWindow(1, "main");
        expect(tracker.snapshot().windows[0]).toMatchObject({ role: "main", state: "created" });
    });

    it("uses a bounded default and validates retention configuration", () => {
        const tracker = createDesktopLifecycleTracker({ maxEvents: 2 });
        for (let i = 1; i <= 3; i++) {
            tracker.registerWindow(i, "auth");
            tracker.updateWindow(i, "closed", "window-closed");
        }
        expect(tracker.snapshot().windows.map((window) => window.id)).toEqual([2, 3]);
        for (const invalid of [-1, 0.5, Infinity, NaN]) {
            expect(() => createDesktopLifecycleTracker({ maxClosedWindows: invalid })).toThrow(RangeError);
        }
    });
});
