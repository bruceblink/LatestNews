import { CrawlerPlatformError } from "../core/errors";

import type { CrawlerHttpRequest } from "./types";
import type { CrawlerNetworkPermission } from "./manifest";

/** Enforce the same HTTPS origin and method policy in every host implementation. */
export function assertCrawlerNetworkPermission(
    permissions: readonly CrawlerNetworkPermission[],
    request: CrawlerHttpRequest
) {
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
