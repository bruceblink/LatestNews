import { $fetch, type FetchOptions } from "ofetch";

// 默认配置
const defaultHeaders = {
    "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
};

const baseFetch = $fetch.create({
    headers: defaultHeaders,
    timeout: 10000,
    retry: 3,
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
