export type FetchSchedulerErrorCode = "CANCELLED" | "QUEUE_FULL" | "TIMEOUT";

export interface FetchSchedulerOptions {
    maxConcurrent: number;
    maxPerKey: number;
    maxQueued: number;
    queueTimeoutMs: number;
    taskTimeoutMs: number;
}

interface FetchJob<T> {
    key: string;
    task: (signal: AbortSignal) => Promise<T>;
    resolve(value: T): void;
    reject(error: unknown): void;
    externalSignal?: AbortSignal;
    controller?: AbortController;
    started: boolean;
    settled: boolean;
    queueTimer?: ReturnType<typeof setTimeout>;
    taskTimer?: ReturnType<typeof setTimeout>;
    removeExternalAbort?: () => void;
}

export class FetchSchedulerError extends Error {
    constructor(
        readonly code: FetchSchedulerErrorCode,
        message: string
    ) {
        super(message);
        this.name = "FetchSchedulerError";
    }
}

/** Schedule outbound source requests with total and per-origin resource limits. */
export function createFetchScheduler(options: FetchSchedulerOptions) {
    validateOptions(options);

    const jobs: FetchJob<unknown>[] = [];
    const activeByKey = new Map<string, number>();
    let activeCount = 0;

    return {
        run<T>(key: string, task: (signal: AbortSignal) => Promise<T>, externalSignal?: AbortSignal): Promise<T> {
            return new Promise<T>((resolve, reject) => {
                const job: FetchJob<T> = {
                    key,
                    task,
                    resolve,
                    reject,
                    ...(externalSignal ? { externalSignal } : {}),
                    started: false,
                    settled: false,
                };

                if (externalSignal?.aborted) {
                    reject(createCancelledError());
                    return;
                }

                const onExternalAbort = () => {
                    if (!job.started) {
                        removeQueuedJob(job);
                        settleRejected(job, createCancelledError());
                        return;
                    }
                    job.controller?.abort();
                    settleRejected(job, createCancelledError());
                };
                externalSignal?.addEventListener("abort", onExternalAbort, { once: true });
                job.removeExternalAbort = () => externalSignal?.removeEventListener("abort", onExternalAbort);

                if (canStart(key)) {
                    start(job);
                    return;
                }
                if (jobs.length >= options.maxQueued) {
                    job.removeExternalAbort();
                    reject(new FetchSchedulerError("QUEUE_FULL", "Fetch request queue is full."));
                    return;
                }

                job.queueTimer = setTimeout(() => {
                    removeQueuedJob(job);
                    settleRejected(
                        job,
                        new FetchSchedulerError("TIMEOUT", "Fetch request exceeded its queue wait limit.")
                    );
                }, options.queueTimeoutMs);
                jobs.push(job as FetchJob<unknown>);
            });
        },
        get activeCount() {
            return activeCount;
        },
        get queuedCount() {
            return jobs.length;
        },
        get activeKeys() {
            return new Map(activeByKey);
        },
    };

    function start<T>(job: FetchJob<T>) {
        if (job.queueTimer) clearTimeout(job.queueTimer);
        job.started = true;
        job.controller = new AbortController();
        activeCount += 1;
        activeByKey.set(job.key, (activeByKey.get(job.key) ?? 0) + 1);
        job.taskTimer = setTimeout(() => {
            job.controller?.abort();
            settleRejected(job, new FetchSchedulerError("TIMEOUT", "Fetch request exceeded its execution limit."));
        }, options.taskTimeoutMs);

        void Promise.resolve()
            .then(() => job.task(job.controller!.signal))
            .then(
                (value) => settleResolved(job, value),
                (error) => settleRejected(job, error)
            )
            .finally(() => release(job));
    }

    function release<T>(job: FetchJob<T>) {
        if (!job.started) return;
        if (job.taskTimer) clearTimeout(job.taskTimer);
        job.removeExternalAbort?.();
        activeCount -= 1;
        const keyCount = (activeByKey.get(job.key) ?? 1) - 1;
        if (keyCount === 0) activeByKey.delete(job.key);
        else activeByKey.set(job.key, keyCount);
        drain();
    }

    function drain() {
        while (activeCount < options.maxConcurrent) {
            const index = jobs.findIndex((job) => canStart(job.key));
            if (index < 0) return;
            const [next] = jobs.splice(index, 1);
            if (next) start(next);
        }
    }

    function canStart(key: string) {
        return activeCount < options.maxConcurrent && (activeByKey.get(key) ?? 0) < options.maxPerKey;
    }

    function removeQueuedJob<T>(job: FetchJob<T>) {
        const index = jobs.indexOf(job as FetchJob<unknown>);
        if (index >= 0) jobs.splice(index, 1);
        if (job.queueTimer) clearTimeout(job.queueTimer);
        job.removeExternalAbort?.();
    }

    function settleResolved<T>(job: FetchJob<T>, value: T) {
        if (job.settled) return;
        job.settled = true;
        job.resolve(value);
    }

    function settleRejected<T>(job: FetchJob<T>, error: unknown) {
        if (job.settled) return;
        job.settled = true;
        job.reject(error);
    }
}

function validateOptions(options: FetchSchedulerOptions) {
    for (const [name, value] of Object.entries(options)) {
        const minimum = name === "maxQueued" ? 0 : 1;
        if (!Number.isInteger(value) || value < minimum) {
            throw new RangeError(`${name} must be ${minimum === 0 ? "a nonnegative" : "a positive"} integer.`);
        }
    }
}

function createCancelledError() {
    return new FetchSchedulerError("CANCELLED", "Fetch request was cancelled.");
}
