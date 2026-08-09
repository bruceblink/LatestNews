import { latestNewsSyncHubCollections } from "./synchub-contract";

import type { SyncHubTransitionSource } from "./synchub-status";
import type { LatestNewsSyncHubCollection } from "./synchub-contract";

export interface SyncHubUploadOutcome {
    failed: LatestNewsSyncHubCollection[];
    error?: unknown;
}

export interface SyncHubUploadQueueScheduler {
    schedule(callback: () => void, delay: number): unknown;
    cancel(handle: unknown): void;
}

export interface SyncHubUploadQueueResult {
    attempted: LatestNewsSyncHubCollection[];
    failed: LatestNewsSyncHubCollection[];
    queuedDuringUpload: LatestNewsSyncHubCollection[];
    pendingCollections: LatestNewsSyncHubCollection[];
    source: SyncHubTransitionSource;
    error?: unknown;
}

interface SyncHubUploadQueueOptions {
    debounceMs: number;
    run(collections: LatestNewsSyncHubCollection[], source: SyncHubTransitionSource): Promise<SyncHubUploadOutcome>;
    onQueued(pendingCollections: LatestNewsSyncHubCollection[], source: SyncHubTransitionSource): void;
    onStart(collections: LatestNewsSyncHubCollection[], source: SyncHubTransitionSource): void;
    onResult(result: SyncHubUploadQueueResult): void;
    scheduler?: SyncHubUploadQueueScheduler;
}

const browserScheduler: SyncHubUploadQueueScheduler = {
    schedule: (callback, delay) => setTimeout(callback, delay),
    cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Batches local SyncHub changes into one upload while retaining failures for user-triggered retry.
 * The queue owns timer cleanup and exposes lifecycle callbacks so React code stays a thin adapter.
 */
export class SyncHubUploadQueue {
    private readonly pending = new Set<LatestNewsSyncHubCollection>();
    private timer: unknown;
    private running = false;
    private disposed = false;
    private readonly scheduler: SyncHubUploadQueueScheduler;

    constructor(private readonly options: SyncHubUploadQueueOptions) {
        this.scheduler = options.scheduler ?? browserScheduler;
    }

    enqueue(
        collections: LatestNewsSyncHubCollection[],
        source: SyncHubTransitionSource = "auto-upload",
        delay = this.options.debounceMs
    ) {
        if (this.disposed || !collections.length) return;

        for (const collection of collections) this.pending.add(collection);
        this.options.onQueued(this.getPendingCollections(), source);
        this.schedule(source, delay);
    }

    dispose() {
        this.disposed = true;
        this.pending.clear();
        if (this.timer !== undefined) this.scheduler.cancel(this.timer);
        this.timer = undefined;
    }

    private schedule(source: SyncHubTransitionSource, delay: number) {
        if (this.timer !== undefined) this.scheduler.cancel(this.timer);
        this.timer = this.scheduler.schedule(() => {
            this.timer = undefined;
            void this.flush(source);
        }, delay);
    }

    private async flush(source: SyncHubTransitionSource) {
        if (this.disposed || this.running) return;

        const attempted = this.getPendingCollections();
        if (!attempted.length) return;

        for (const collection of attempted) this.pending.delete(collection);
        this.running = true;
        this.options.onStart(attempted, source);

        let outcome: SyncHubUploadOutcome;
        try {
            outcome = await this.options.run(attempted, source);
        } catch (error) {
            outcome = { failed: attempted, error };
        }
        if (this.disposed) return;

        const queuedDuringUpload = this.getPendingCollections();
        for (const collection of outcome.failed) this.pending.add(collection);
        const pendingCollections = this.getPendingCollections();
        this.running = false;

        this.options.onResult({
            attempted,
            failed: outcome.failed,
            queuedDuringUpload,
            pendingCollections,
            source,
            error: outcome.error,
        });

        if (queuedDuringUpload.length > 0) this.schedule("auto-upload", this.options.debounceMs);
    }

    private getPendingCollections() {
        return latestNewsSyncHubCollections.filter((collection) => this.pending.has(collection));
    }
}
