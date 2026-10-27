import { CrawlerPlatformError } from "../core/errors";
import { utf8ByteLength, utf8HeadersByteLength, defaultCrawlerPluginLimits } from "./limits";

import type { CrawlerNetworkPermission } from "./manifest";
import type { CrawlerHttpRequest, CrawlerHttpResponse } from "./types";

const httpMethods = new Set(["GET", "HEAD", "POST"]);
const headerNamePattern = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const forbiddenRequestHeaders = new Set([
    "authorization",
    "cookie",
    "connection",
    "content-length",
    "forwarded",
    "host",
    "keep-alive",
    "proxy-authorization",
    "proxy-connection",
    "set-cookie",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    "x-access-token",
    "x-api-key",
    "x-auth-token",
    "x-forwarded-for",
    "x-forwarded-host",
    "x-forwarded-proto",
]);

/** Enforce the same HTTPS origin and method policy in every host implementation. */
export function assertCrawlerNetworkPermission(
    permissions: readonly CrawlerNetworkPermission[],
    request: unknown,
    maxHeaderBytes = defaultCrawlerPluginLimits.maxRequestHeadersBytes
) {
    assertCrawlerHttpRequest(request, maxHeaderBytes);
    let url: URL;
    try {
        url = new URL(request.url);
    } catch {
        throw new CrawlerPlatformError("NETWORK_PERMISSION_DENIED", "Request URL is invalid.");
    }

    const method = request.method ?? "GET";
    const allowed =
        url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        permissions.some((permission) => permission.origin === url.origin && permission.methods.includes(method));
    if (!allowed) {
        throw new CrawlerPlatformError("NETWORK_PERMISSION_DENIED", `Request ${method} ${url.origin} is not allowed.`);
    }
}

export function assertCrawlerHttpRequest(
    input: unknown,
    maxHeaderBytes = defaultCrawlerPluginLimits.maxRequestHeadersBytes
): asserts input is CrawlerHttpRequest {
    if (!isRecord(input) || typeof input.url !== "string" || input.url.length === 0) {
        throw new CrawlerPlatformError("INVALID_PLUGIN", "HTTP request must contain a URL string.");
    }

    const method = input.method ?? "GET";
    if (typeof method !== "string" || !httpMethods.has(method)) {
        throw new CrawlerPlatformError("INVALID_PLUGIN", `HTTP method ${String(method)} is not supported.`);
    }
    if (input.body !== undefined && typeof input.body !== "string") {
        throw new CrawlerPlatformError("INVALID_PLUGIN", "HTTP request body must be a string.");
    }
    if ((method === "GET" || method === "HEAD") && input.body !== undefined) {
        throw new CrawlerPlatformError("INVALID_PLUGIN", `${method} requests cannot include a body.`);
    }

    if (input.headers === undefined) return;
    if (!isRecord(input.headers)) {
        throw new CrawlerPlatformError("INVALID_PLUGIN", "HTTP request headers must be a string map.");
    }

    const headers = Object.create(null) as Record<string, string>;
    for (const [name, value] of Object.entries(input.headers)) {
        if (!headerNamePattern.test(name) || typeof value !== "string" || /[\r\n]/.test(value)) {
            throw new CrawlerPlatformError(
                "INVALID_PLUGIN",
                "HTTP request headers must use valid string names and values."
            );
        }
        if (forbiddenRequestHeaders.has(name.toLowerCase())) {
            throw new CrawlerPlatformError(
                "NETWORK_PERMISSION_DENIED",
                `Request header ${name.toLowerCase()} is reserved for host-managed credentials.`
            );
        }
        headers[name] = value;
    }
    if (utf8HeadersByteLength(headers) > maxHeaderBytes) {
        throw new CrawlerPlatformError("RESOURCE_LIMIT", `Request headers exceed ${maxHeaderBytes} bytes.`);
    }
}

export function assertCrawlerHttpResponse(
    input: unknown,
    {
        maxBodyBytes = defaultCrawlerPluginLimits.maxResponseBytes,
        maxHeaderBytes = defaultCrawlerPluginLimits.maxResponseHeadersBytes,
    }: { maxBodyBytes?: number; maxHeaderBytes?: number } = {}
): asserts input is CrawlerHttpResponse {
    if (
        !isRecord(input) ||
        typeof input.status !== "number" ||
        !Number.isInteger(input.status) ||
        input.status < 100 ||
        input.status > 599
    ) {
        throw new CrawlerPlatformError("INVALID_PLUGIN", "HTTP response status must be an integer from 100 to 599.");
    }
    if (!isRecord(input.headers) || typeof input.body !== "string") {
        throw new CrawlerPlatformError("INVALID_PLUGIN", "HTTP response must contain headers and a string body.");
    }

    const headers = Object.create(null) as Record<string, string>;
    for (const [name, value] of Object.entries(input.headers)) {
        if (!headerNamePattern.test(name) || typeof value !== "string" || /[\r\n]/.test(value)) {
            throw new CrawlerPlatformError(
                "INVALID_PLUGIN",
                "HTTP response headers must use valid string names and values."
            );
        }
        if (name.toLowerCase() === "set-cookie") {
            throw new CrawlerPlatformError(
                "NETWORK_PERMISSION_DENIED",
                "Set-Cookie responses are not exposed to plugins."
            );
        }
        headers[name] = value;
    }
    if (utf8HeadersByteLength(headers) > maxHeaderBytes) {
        throw new CrawlerPlatformError("RESOURCE_LIMIT", `Response headers exceed ${maxHeaderBytes} bytes.`);
    }
    if (utf8ByteLength(input.body) > maxBodyBytes) {
        throw new CrawlerPlatformError("RESOURCE_LIMIT", `Response exceeds ${maxBodyBytes} bytes.`);
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
