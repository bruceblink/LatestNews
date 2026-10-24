export type ApiService = "news" | "auth";

export interface ApiServiceTargets {
    news: URL | null;
    auth: URL;
}

export interface ApiProxyTarget {
    service: ApiService;
    url: URL;
}

const APP_ORIGIN = "app://bundle";
const AUTH_PREFIX = "/__auth-api__";

/** Accept only explicit service roots; HTTP is limited to local development. */
export function normalizeServiceUrl(value: string, options: { allowLocalHttp: boolean }) {
    const url = new URL(value);
    const localHost = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);

    if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
        throw new Error("Service URLs must be origin-only URLs without credentials, paths, or query values.");
    }
    if (url.protocol !== "https:" && !(options.allowLocalHttp && localHost && url.protocol === "http:")) {
        throw new Error("Service URLs must use HTTPS. HTTP is allowed only for local development.");
    }

    return url;
}

/** Map only the news API and the fixed authentication API path to configured origins. */
export function resolveApiProxyTarget(requestUrl: string, targets: ApiServiceTargets): ApiProxyTarget | null {
    let request: URL;
    try {
        request = new URL(requestUrl);
    } catch {
        return null;
    }

    if (request.protocol !== "app:" || request.hostname !== "bundle" || request.username || request.password) {
        return null;
    }

    let service: ApiService;
    let targetPath: string;
    if (request.pathname === "/api" || request.pathname.startsWith("/api/")) {
        service = "news";
        targetPath = request.pathname;
    } else if (request.pathname === AUTH_PREFIX || request.pathname.startsWith(`${AUTH_PREFIX}/`)) {
        service = "auth";
        targetPath = request.pathname.slice(AUTH_PREFIX.length) || "/";
        if (targetPath !== "/logout" && targetPath !== "/auth/oauth/github/login" && !targetPath.startsWith("/api/")) {
            return null;
        }
    } else {
        return null;
    }

    let decodedPath: string;
    try {
        decodedPath = decodeURIComponent(targetPath);
    } catch {
        return null;
    }
    if (
        decodedPath.includes("\\") ||
        decodedPath.includes("\0") ||
        decodedPath.split("/").some((part) => part === "." || part === "..")
    ) {
        return null;
    }

    const targetOrigin = targets[service];
    if (!targetOrigin) return null;

    const target = new URL(targetPath, targetOrigin);
    target.search = request.search;
    target.hash = "";
    if (target.origin !== targetOrigin.origin) return null;

    return { service, url: target };
}

/** Drop browser cookies and hop-by-hop headers before contacting a different service. */
export function createUpstreamHeaders(requestHeaders: Headers, targetOrigin: string): Headers {
    const headers = new Headers();
    const blocked = new Set([
        "connection",
        "cookie",
        "host",
        "origin",
        "proxy-authorization",
        "proxy-connection",
        "referer",
        "sec-fetch-dest",
        "sec-fetch-mode",
        "sec-fetch-site",
        "transfer-encoding",
    ]);

    for (const [name, value] of requestHeaders) {
        if (!blocked.has(name.toLowerCase())) headers.append(name, value);
    }
    if (requestHeaders.has("origin")) headers.set("origin", targetOrigin);

    return headers;
}

/** Keep same-origin redirects inside the corresponding local API prefix. */
export function rewriteApiRedirectLocation(location: string, targetOrigin: string, service: ApiService) {
    try {
        const target = new URL(location, targetOrigin);
        if (target.origin !== targetOrigin) return null;
        const prefix = service === "news" ? "" : AUTH_PREFIX;
        return `${APP_ORIGIN}${prefix}${target.pathname}${target.search}`;
    } catch {
        return null;
    }
}
