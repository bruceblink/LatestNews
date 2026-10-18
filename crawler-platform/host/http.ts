import { CrawlerPlatformError } from "../core/errors";

import type { CrawlerHttpRequest, CrawlerHttpResponse } from "../sdk/types";

/** Perform an allowlisted request with bounded redirects and a limit on decompressed response bytes. */
export async function requestCrawlerHttp(request: CrawlerHttpRequest, signal: AbortSignal) {
    let url = new URL(request.url);
    let method = request.method ?? "GET";
    let body = request.body;

    for (let redirects = 0; redirects <= 5; redirects += 1) {
        const response = await fetch(url, {
            method,
            headers: request.headers,
            ...(body !== undefined && method !== "GET" && method !== "HEAD" ? { body } : {}),
            redirect: "manual",
            signal,
        });
        if (![301, 302, 303, 307, 308].includes(response.status)) {
            return {
                status: response.status,
                headers: Object.fromEntries(response.headers.entries()),
                body: await readBoundedText(response, signal),
            } satisfies CrawlerHttpResponse;
        }

        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location || redirects === 5) {
            throw new CrawlerPlatformError("HTTP_FAILED", "Upstream redirect limit exceeded or Location is missing.");
        }

        const target = new URL(location, url);
        if (target.protocol !== "https:" || target.origin !== url.origin || target.username || target.password) {
            throw new CrawlerPlatformError("NETWORK_PERMISSION_DENIED", "Cross-origin or non-HTTPS redirect blocked.");
        }
        if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === "POST")) {
            method = "GET";
            body = undefined;
        }
        url = target;
    }

    throw new CrawlerPlatformError("HTTP_FAILED", "Unreachable redirect state.");
}

async function readBoundedText(response: Response, signal: AbortSignal) {
    if (!response.body) return "";
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    try {
        while (true) {
            if (signal.aborted) throw new CrawlerPlatformError("CANCELLED", "HTTP request was cancelled.");
            const { done, value } = await reader.read();
            if (done) break;
            totalBytes += value.byteLength;
            if (totalBytes > 2 * 1024 * 1024) {
                await reader.cancel();
                throw new CrawlerPlatformError("HTTP_FAILED", "Upstream response exceeds 2 MiB.");
            }
            chunks.push(value);
        }
    } finally {
        reader.releaseLock();
    }

    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return new TextDecoder().decode(bytes);
}
