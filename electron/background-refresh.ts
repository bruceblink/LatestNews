const DEFAULT_SOURCE_INTERVAL_MS = 10 * 60 * 1000;
const MIN_SOURCE_INTERVAL_MS = 30 * 1000;
const MAX_SOURCE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const MAX_CONCURRENT_REFRESHES = 2;

export interface BackgroundRefreshSource {
    id: string;
    interval: number;
}

export interface DesktopBackgroundRefreshOptions {
    listSources: () => readonly BackgroundRefreshSource[];
    refreshSource: (sourceId: string) => Promise<unknown>;
    canRefresh?: () => boolean;
    onError?: (sourceId: string, error: unknown) => void;
    now?: () => number;
}

/** Schedule bounded local refreshes without replaying every interval missed during sleep. */
export function createDesktopBackgroundRefresh(options: DesktopBackgroundRefreshOptions) {
    const now = options.now ?? Date.now;
    const nextRefreshAt = new Map<string, number>();
    const pausedReasons = new Set<string>();
    let enabled = false;
    let generation = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let runningPromise: Promise<void> | undefined;
    let manualRefreshPromise: Promise<void> | undefined;
    let runningSourceIds = new Set<string>();

    function start() {
        enabled = true;
        scheduleNext();
    }

    function stop() {
        enabled = false;
        generation += 1;
        clearScheduledTimer();
        nextRefreshAt.clear();
    }

    function pause(reason: string) {
        if (!reason) throw new Error("A pause reason is required.");
        pausedReasons.add(reason);
        clearScheduledTimer();
    }

    function resume(reason: string) {
        pausedReasons.delete(reason);
        if (enabled && pausedReasons.size === 0) scheduleNext();
    }

    function refreshNow(): Promise<void> {
        if (!enabled || options.canRefresh?.() === false) return Promise.resolve();
        if (manualRefreshPromise) return manualRefreshPromise;

        let manualRun: Promise<void>;
        manualRun = (runningPromise ?? Promise.resolve())
            .then(() => runManualRefresh(getCurrentSources().map((source) => source.id)))
            .finally(() => {
                if (manualRefreshPromise !== manualRun) return;
                manualRefreshPromise = undefined;
                scheduleNext();
            });
        manualRefreshPromise = manualRun;
        return manualRun;
    }

    function dispose() {
        stop();
        pausedReasons.clear();
    }

    function snapshot() {
        const currentTime = now();
        const scheduled = [...nextRefreshAt.values()];
        return {
            enabled,
            paused: pausedReasons.size > 0,
            pausedReasons: [...pausedReasons],
            running: runningPromise !== undefined,
            runningSourceCount: runningSourceIds.size,
            nextRefreshAt: scheduled.length ? Math.min(...scheduled) : undefined,
            overdueSourceCount: scheduled.filter((value) => value <= currentTime).length,
        };
    }

    async function runDue() {
        if (!enabled || pausedReasons.size > 0 || options.canRefresh?.() === false) return;
        if (manualRefreshPromise) {
            await manualRefreshPromise;
            return;
        }
        if (runningPromise) {
            await runningPromise;
            await runDue();
            return;
        }

        const currentTime = now();
        const dueIds = getCurrentSources()
            .filter((source) => (nextRefreshAt.get(source.id) ?? 0) <= currentTime)
            .map((source) => source.id);
        if (dueIds.length) await runSources(dueIds);
        else scheduleNext();
    }

    function scheduleNext() {
        clearScheduledTimer();
        if (
            !enabled ||
            pausedReasons.size > 0 ||
            options.canRefresh?.() === false ||
            runningPromise ||
            manualRefreshPromise
        ) {
            return;
        }

        const sources = getCurrentSources();
        if (!sources.length) return;
        const currentTime = now();
        const nextAt = Math.min(...sources.map((source) => nextRefreshAt.get(source.id) ?? currentTime));
        timer = setTimeout(
            () => {
                timer = undefined;
                void runDue();
            },
            Math.max(0, nextAt - currentTime)
        );
    }

    function getCurrentSources() {
        const unique = new Map<string, BackgroundRefreshSource>();
        for (const source of options.listSources()) {
            if (!source.id || unique.has(source.id)) continue;
            unique.set(source.id, {
                id: source.id,
                interval: normalizeSourceInterval(source.interval),
            });
        }
        for (const sourceId of nextRefreshAt.keys()) {
            if (!unique.has(sourceId)) nextRefreshAt.delete(sourceId);
        }
        return [...unique.values()];
    }

    function runSources(sourceIds: readonly string[]): Promise<void> {
        if (!enabled || options.canRefresh?.() === false) return Promise.resolve();
        if (runningPromise) return runningPromise;

        clearScheduledTimer();
        const currentGeneration = generation;
        const sourceById = new Map(getCurrentSources().map((source) => [source.id, source]));
        const selected = [...new Set(sourceIds)].filter(
            (sourceId) => sourceById.has(sourceId) && !runningSourceIds.has(sourceId)
        );
        if (!selected.length) {
            scheduleNext();
            return Promise.resolve();
        }

        let trackedRun: Promise<void>;
        for (const sourceId of selected) runningSourceIds.add(sourceId);
        trackedRun = refreshInBatches(selected, sourceById, currentGeneration).finally(() => {
            for (const sourceId of selected) runningSourceIds.delete(sourceId);
            if (runningPromise === trackedRun) runningPromise = undefined;
            scheduleNext();
        });
        runningPromise = trackedRun;
        return trackedRun;
    }

    async function runManualRefresh(sourceIds: readonly string[]) {
        if (!enabled || options.canRefresh?.() === false) return;
        clearScheduledTimer();
        const sourceById = new Map(getCurrentSources().map((source) => [source.id, source]));
        const selected = [...new Set(sourceIds)].filter(
            (sourceId) => sourceById.has(sourceId) && !runningSourceIds.has(sourceId)
        );
        if (!selected.length) return;
        for (const sourceId of selected) runningSourceIds.add(sourceId);
        try {
            await refreshInBatches(selected, sourceById, generation);
        } finally {
            for (const sourceId of selected) runningSourceIds.delete(sourceId);
        }
    }

    async function refreshInBatches(
        sourceIds: readonly string[],
        sourceById: ReadonlyMap<string, BackgroundRefreshSource>,
        currentGeneration: number
    ) {
        for (let index = 0; index < sourceIds.length; index += MAX_CONCURRENT_REFRESHES) {
            if (!enabled || currentGeneration !== generation) return;
            const batch = sourceIds.slice(index, index + MAX_CONCURRENT_REFRESHES);
            await Promise.all(
                batch.map(async (sourceId) => {
                    try {
                        await options.refreshSource(sourceId);
                    } catch (error) {
                        try {
                            options.onError?.(sourceId, error);
                        } catch {
                            // Diagnostics must not stop scheduling other sources.
                        }
                    } finally {
                        const source = sourceById.get(sourceId);
                        if (enabled && currentGeneration === generation && source) {
                            nextRefreshAt.set(sourceId, now() + source.interval);
                        }
                    }
                })
            );
        }
    }

    function clearScheduledTimer() {
        if (timer === undefined) return;
        clearTimeout(timer);
        timer = undefined;
    }

    return { start, stop, pause, resume, refreshNow, dispose, snapshot };
}

function normalizeSourceInterval(value: number) {
    if (!Number.isFinite(value)) return DEFAULT_SOURCE_INTERVAL_MS;
    return Math.min(MAX_SOURCE_INTERVAL_MS, Math.max(MIN_SOURCE_INTERVAL_MS, Math.floor(value)));
}
