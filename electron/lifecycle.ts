export type DesktopLifecycleEventName =
    | "app-ready"
    | "app-activate"
    | "app-before-quit"
    | "app-will-quit"
    | "app-quit"
    | "app-second-instance"
    | "app-window-all-closed"
    | "window-created"
    | "window-did-start-load"
    | "window-did-finish-load"
    | "window-did-fail-load"
    | "window-ready-to-show"
    | "window-show"
    | "window-hide"
    | "window-minimize"
    | "window-restore"
    | "window-unresponsive"
    | "window-responsive"
    | "window-render-process-gone"
    | "window-closed";

export type DesktopLifecycleValue = boolean | number | string | null;

export interface DesktopLifecycleEvent {
    sequence: number;
    name: DesktopLifecycleEventName;
    elapsedMs: number;
    windowId?: number;
    role?: "main" | "auth";
    details?: Record<string, DesktopLifecycleValue>;
}

export interface DesktopWindowSnapshot {
    id: number;
    role: "main" | "auth";
    state: "created" | "loading" | "ready" | "visible" | "hidden" | "minimized" | "closed";
    createdAtMs: number;
    closedAtMs?: number;
}

export interface DesktopLifecycleSnapshot {
    startedAt: number;
    uptimeMs: number;
    events: DesktopLifecycleEvent[];
    windows: DesktopWindowSnapshot[];
    lastEvent?: DesktopLifecycleEvent;
}

interface DesktopLifecycleTrackerOptions {
    now?: () => number;
    maxEvents?: number;
}

/** Keep a bounded, non-sensitive record of desktop lifecycle transitions. */
export function createDesktopLifecycleTracker(options: DesktopLifecycleTrackerOptions = {}) {
    const now = options.now ?? Date.now;
    const maxEvents = options.maxEvents ?? 128;
    if (!Number.isInteger(maxEvents) || maxEvents < 1) throw new RangeError("maxEvents must be a positive integer.");

    const startedAt = now();
    const events: DesktopLifecycleEvent[] = [];
    const windows = new Map<number, DesktopWindowSnapshot>();
    let sequence = 0;

    function record(
        name: DesktopLifecycleEventName,
        metadata: {
            windowId?: number;
            role?: "main" | "auth";
            details?: Record<string, DesktopLifecycleValue>;
        } = {}
    ) {
        const event: DesktopLifecycleEvent = {
            sequence: ++sequence,
            name,
            elapsedMs: Math.max(0, now() - startedAt),
            ...(metadata.windowId !== undefined ? { windowId: metadata.windowId } : {}),
            ...(metadata.role ? { role: metadata.role } : {}),
            ...(metadata.details ? { details: { ...metadata.details } } : {}),
        };
        events.push(event);
        if (events.length > maxEvents) events.shift();
        return event;
    }

    function registerWindow(id: number, role: "main" | "auth") {
        windows.set(id, { id, role, state: "created", createdAtMs: Math.max(0, now() - startedAt) });
        record("window-created", { windowId: id, role });
    }

    function updateWindow(
        id: number,
        state: DesktopWindowSnapshot["state"],
        name: DesktopLifecycleEventName,
        details?: Record<string, DesktopLifecycleValue>
    ) {
        const current = windows.get(id);
        if (current) {
            windows.set(id, {
                ...current,
                state,
                ...(state === "closed" ? { closedAtMs: Math.max(0, now() - startedAt) } : {}),
            });
            record(name, { windowId: id, role: current.role, ...(details ? { details } : {}) });
            return;
        }
        record(name, { windowId: id, ...(details ? { details } : {}) });
    }

    function snapshot(): DesktopLifecycleSnapshot {
        const latest = events[events.length - 1];
        return {
            startedAt,
            uptimeMs: Math.max(0, now() - startedAt),
            events: events.map((event) => ({
                ...event,
                ...(event.details ? { details: { ...event.details } } : {}),
            })),
            windows: [...windows.values()].map((window) => ({ ...window })),
            ...(latest
                ? { lastEvent: { ...latest, ...(latest.details ? { details: { ...latest.details } } : {}) } }
                : {}),
        };
    }

    return { record, registerWindow, updateWindow, snapshot };
}

export type DesktopLifecycleTracker = ReturnType<typeof createDesktopLifecycleTracker>;
