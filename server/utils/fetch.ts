import { $fetch, type FetchOptions, type FetchResponse } from "ofetch";

import { createFetchScheduler } from "./fetch-scheduler";

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

const baseFetch = $fetch.create({
    headers: defaultHeaders,
    timeout: 10000,
    retry: 3,
    retryDelay: RETRY_DELAY_MS,
    retryStatusCodes: [408, 409, 425, 429, 500, 502, 503, 504],
    fetch: createBoundedFetch(fetchSchedulerDefaults.maxResponseBytes),
});

const fetchScheduler = createFetchScheduler(fetchSchedulerDefaults);

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
    return fetchScheduler.run(
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
        externalSignal ?? undefined
    );
}

export function myFetchRaw<T>(url: string, options: FetchOptions<any> = {}): Promise<FetchResponse<T>> {
    const { signal: externalSignal, ...fetchOptions } = options;
    return fetchScheduler.run(
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
        externalSignal ?? undefined
    );
}

export function createBoundedFetch(maxBytes: number, fetchImpl: typeof globalThis.fetch = globalThis.fetch) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
        throw new RangeError("maxBytes must be a positive safe integer.");
    }

    return async (input: RequestInfo | URL, init?: RequestInit) => {
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
