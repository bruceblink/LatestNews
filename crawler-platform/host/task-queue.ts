import { CrawlerPlatformError } from "../core/errors";

export interface CrawlerTaskQueueOptions {
    maxConcurrent: number;
    maxQueued: number;
    queueTimeoutMs: number;
}

interface QueueJob<T> {
    task: () => Promise<T>;
    resolve(value: T): void;
    reject(error: unknown): void;
    timeout?: ReturnType<typeof setTimeout>;
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
        run<T>(task: () => Promise<T>): Promise<T> {
            return new Promise<T>((resolve, reject) => {
                if (closed) {
                    reject(new CrawlerPlatformError("CANCELLED", "Crawler task queue is closed."));
                    return;
                }
                const job: QueueJob<T> = { task, resolve, reject };
                if (activeCount < options.maxConcurrent) {
                    start(job);
                    return;
                }
                if (jobs.length >= options.maxQueued) {
                    reject(new CrawlerPlatformError("QUEUE_FULL", "Crawler task queue is full."));
                    return;
                }

                job.timeout = setTimeout(() => {
                    const index = jobs.indexOf(job as QueueJob<unknown>);
                    if (index < 0) return;
                    jobs.splice(index, 1);
                    reject(new CrawlerPlatformError("TIMEOUT", "Crawler task exceeded its queue wait limit."));
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
                job.reject(error);
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
        activeCount += 1;
        void Promise.resolve()
            .then(job.task)
            .then(job.resolve, job.reject)
            .finally(() => {
                activeCount -= 1;
                if (closed) return;
                const next = jobs.shift();
                if (next) start(next);
            });
    }
}
