import { CrawlerPlatformError } from "../core/errors";

export interface CrawlerTaskQueueOptions {
    maxConcurrent: number;
    maxQueued: number;
    queueTimeoutMs: number;
}

interface QueueJob<T> {
    task: (signal: AbortSignal) => Promise<T>;
    resolve(value: T): void;
    reject(error: unknown): void;
    controller?: AbortController;
    started: boolean;
    settled: boolean;
    timeout?: ReturnType<typeof setTimeout>;
    removeExternalAbort?: () => void;
}

/** Bound host-wide plugin concurrency and reject work that cannot start within the queue budget. */
export function createCrawlerTaskQueue(options: CrawlerTaskQueueOptions) {
    if (!Number.isInteger(options.maxConcurrent) || options.maxConcurrent < 1) {
        throw new RangeError("maxConcurrent must be a positive integer.");
    }
    if (!Number.isInteger(options.maxQueued) || options.maxQueued < 0) {
        throw new RangeError("maxQueued must be a nonnegative integer.");
    }
    if (!Number.isInteger(options.queueTimeoutMs) || options.queueTimeoutMs < 1) {
        throw new RangeError("queueTimeoutMs must be a positive integer.");
    }

    const jobs: QueueJob<unknown>[] = [];
    let activeCount = 0;
    let closed = false;

    return {
        run<T>(task: (signal: AbortSignal) => Promise<T>, externalSignal?: AbortSignal): Promise<T> {
            return new Promise<T>((resolve, reject) => {
                if (closed) {
                    reject(new CrawlerPlatformError("CANCELLED", "Crawler task queue is closed."));
                    return;
                }
                const job: QueueJob<T> = { task, resolve, reject, started: false, settled: false };
                if (externalSignal?.aborted) {
                    reject(new CrawlerPlatformError("CANCELLED", "Crawler task was cancelled."));
                    return;
                }
                const onExternalAbort = () => {
                    if (!job.started) {
                        removeQueuedJob(job);
                        settleRejected(job, new CrawlerPlatformError("CANCELLED", "Crawler task was cancelled."));
                        return;
                    }
                    job.controller?.abort();
                    settleRejected(job, new CrawlerPlatformError("CANCELLED", "Crawler task was cancelled."));
                };
                externalSignal?.addEventListener("abort", onExternalAbort, { once: true });
                job.removeExternalAbort = () => externalSignal?.removeEventListener("abort", onExternalAbort);
                if (activeCount < options.maxConcurrent) {
                    start(job);
                    return;
                }
                if (jobs.length >= options.maxQueued) {
                    job.removeExternalAbort();
                    reject(new CrawlerPlatformError("QUEUE_FULL", "Crawler task queue is full."));
                    return;
                }

                job.timeout = setTimeout(() => {
                    removeQueuedJob(job);
                    settleRejected(
                        job,
                        new CrawlerPlatformError("TIMEOUT", "Crawler task exceeded its queue wait limit.")
                    );
                }, options.queueTimeoutMs);
                jobs.push(job as QueueJob<unknown>);
            });
        },
        close(error: CrawlerPlatformError = new CrawlerPlatformError("CANCELLED", "Crawler task queue is closed.")) {
            if (closed) return;
            closed = true;
            while (jobs.length > 0) {
                const job = jobs.shift()!;
                if (job.timeout) clearTimeout(job.timeout);
                job.removeExternalAbort?.();
                settleRejected(job, error);
            }
        },
        get activeCount() {
            return activeCount;
        },
        get queuedCount() {
            return jobs.length;
        },
    };

    function start<T>(job: QueueJob<T>) {
        if (job.timeout) clearTimeout(job.timeout);
        job.started = true;
        job.controller = new AbortController();
        activeCount += 1;
        void Promise.resolve()
            .then(() => job.task(job.controller!.signal))
            .then(
                (value) => settleResolved(job, value),
                (error) => settleRejected(job, error)
            )
            .finally(() => {
                job.removeExternalAbort?.();
                activeCount -= 1;
                if (closed) return;
                const next = jobs.shift();
                if (next) start(next);
            });
    }

    function removeQueuedJob<T>(job: QueueJob<T>) {
        const index = jobs.indexOf(job as QueueJob<unknown>);
        if (index >= 0) jobs.splice(index, 1);
        if (job.timeout) clearTimeout(job.timeout);
        job.removeExternalAbort?.();
    }

    function settleResolved<T>(job: QueueJob<T>, value: T) {
        if (job.settled) return;
        job.settled = true;
        job.resolve(value);
    }

    function settleRejected<T>(job: QueueJob<T>, error: unknown) {
        if (job.settled) return;
        job.settled = true;
        job.reject(error);
    }
}
