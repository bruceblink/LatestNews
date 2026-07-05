import { $fetch, type FetchOptions } from "ofetch";

const RETRY_DELAY_MS = 500;

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
});

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
    return baseFetch<T>(url, {
        ...options,
        headers: {
            ...defaultHeaders,
            ...normalizeHeaders(options.headers),
        },
    });
}
