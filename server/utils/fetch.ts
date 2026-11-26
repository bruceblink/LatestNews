import { AsyncLocalStorage } from "node:async_hooks";
import { $fetch, type FetchOptions, type FetchResponse } from "ofetch";

import { FetchSchedulerError, createFetchScheduler } from "./fetch-scheduler";

import type { CollectionTrace } from "./collection-trace";

const RETRY_DELAY_MS = 500;

export const fetchSchedulerDefaults = {
    maxConcurrent: 8,
    maxPerKey: 2,
    maxQueued: 100,
    queueTimeoutMs: 8_000,
    taskTimeoutMs: 8_000,
    maxResponseBytes: 2 * 1024 * 1024,
} as const;

export class FetchResponseTooLargeError extends Error {
    readonly code = "RESPONSE_TOO_LARGE" as const;

    constructor(readonly maxBytes: number) {
        super(`Upstream response exceeds ${maxBytes} bytes.`);
        this.name = "FetchResponseTooLargeError";
    }
}

// 默认配置
const defaultHeaders = {
    "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
};

const baseFetch = $fetch.create(
    {
        headers: defaultHeaders,
        timeout: 10000,
        retry: 3,
        retryDelay: RETRY_DELAY_MS,
        retryStatusCodes: [408, 409, 425, 429, 500, 502, 503, 504],
    },
    {
        fetch: createBoundedFetch(fetchSchedulerDefaults.maxResponseBytes),
    }
);

const fetchScheduler = createFetchScheduler(fetchSchedulerDefaults);
type RequestFetchScheduler = ReturnType<typeof createFetchScheduler>;
const requestFetchScheduler = new AsyncLocalStorage<RequestFetchScheduler>();

/** Workers cannot transfer queued I/O or abort handles across requests.
 * The shared admission gate contains only counters, never a promise or timer.
 * A saturated cross-request budget rejects rather than borrowing another request's queue. */
export function createFetchAdmission(maxConcurrent: number, maxPerKey: number, leaseMs = 30_000, now = Date.now) {
    // The lease is longer than the request scheduler's task deadline.
    // If the platform kills a request without running finally, its slot
    // becomes available again. No cross-request timer is needed.
    const active = new Map<symbol, { key: string; expiresAt: number }>();
    return (key: string) => {
        const time = now();
        let count = 0;
        for (const [token, entry] of active) {
            if (entry.expiresAt <= time) active.delete(token);
            else if (entry.key === key) count++;
        }
        if (active.size >= maxConcurrent || count >= maxPerKey) {
            throw new FetchSchedulerError("QUEUE_FULL", "Request fetch admission limit reached.");
        }
        const token = Symbol();
        active.set(token, { key, expiresAt: time + leaseMs });
        return () => {
            active.delete(token);
        };
    };
}

const admitPagesFetch = createFetchAdmission(fetchSchedulerDefaults.maxConcurrent, fetchSchedulerDefaults.maxPerKey);

export function createRequestFetchScheduler() {
    return createFetchScheduler(fetchSchedulerDefaults);
}

export function runWithRequestFetchScheduler<T>(scheduler: RequestFetchScheduler, task: () => T): T {
    return requestFetchScheduler.run(scheduler, task);
}

function scheduleFetch<T>(key: string, task: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal) {
    const local = requestFetchScheduler.getStore();
    if (!local) return fetchScheduler.run(key, task, signal);
    return local.run(
        key,
        async (collectionSignal) => {
            const release = admitPagesFetch(key);
            try {
                return await task(collectionSignal);
            } finally {
                release();
            }
        },
        signal
    );
}

export function setFetchTrace(trace?: CollectionTrace) {
    fetchScheduler.setTrace(trace);
}
export const legacySourceSignal = new AsyncLocalStorage<AbortSignal>();

function normalizeHeaders(h?: FetchOptions["headers"]): Record<string, string> {
    if (!h) return {};
    if (h instanceof Headers) {
        return Object.fromEntries(h.entries());
    }
    if (Array.isArray(h)) {
        return Object.fromEntries(h);
    }
    return h as Record<string, string>;
}

export function myFetch<T>(url: string, options: FetchOptions<any> = {}): Promise<T> {
    const { signal: externalSignal, ...fetchOptions } = options;
    return scheduleFetch(
        getFetchKey(url),
        (signal) =>
            baseFetch<T>(url, {
                ...fetchOptions,
                signal,
                headers: {
                    ...defaultHeaders,
                    ...normalizeHeaders(options.headers),
                },
            }),
        externalSignal ?? legacySourceSignal.getStore()
    );
}

export function myFetchRaw<T>(url: string, options: FetchOptions<any> = {}): Promise<FetchResponse<T>> {
    const { signal: externalSignal, ...fetchOptions } = options;
    return scheduleFetch(
        getFetchKey(url),
        (signal) =>
            baseFetch.raw<T>(url, {
                ...fetchOptions,
                signal,
                headers: {
                    ...defaultHeaders,
                    ...normalizeHeaders(options.headers),
                },
            }),
        externalSignal ?? legacySourceSignal.getStore()
    );
}

export function createBoundedFetch(maxBytes: number, fetchImpl: typeof globalThis.fetch = globalThis.fetch) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
        throw new RangeError("maxBytes must be a positive safe integer.");
    }

    return async (input: Parameters<typeof globalThis.fetch>[0], init?: Parameters<typeof globalThis.fetch>[1]) => {
        // ofetch can retry aborted requests when a default timeout is configured.
        init?.signal?.throwIfAborted();
        const response = await fetchImpl(input, init);
        const contentLength = Number(response.headers.get("content-length"));
        if (response.body && Number.isSafeInteger(contentLength) && contentLength > maxBytes) {
            await response.body.cancel();
            throw new FetchResponseTooLargeError(maxBytes);
        }
        if (!response.body) return response;

        const reader = response.body.getReader();
        let totalBytes = 0;
        const body = new ReadableStream<Uint8Array>({
            async pull(controller) {
                try {
                    const { done, value } = await reader.read();
                    if (done) {
                        controller.close();
                        return;
                    }
                    totalBytes += value.byteLength;
                    if (totalBytes > maxBytes) {
                        await reader.cancel();
                        controller.error(new FetchResponseTooLargeError(maxBytes));
                        return;
                    }
                    controller.enqueue(value);
                } catch (error) {
                    controller.error(error);
                }
            },
            async cancel(reason) {
                await reader.cancel(reason);
            },
        });

        return new Response(body, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
        });
    };
}

function getFetchKey(url: string) {
    try {
        return new URL(url).origin;
    } catch {
        return "invalid-url";
    }
}
