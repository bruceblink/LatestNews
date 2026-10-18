import { CrawlerPlatformError } from "../core/errors";

import type { CrawlerHttpRequest, CrawlerHttpResponse } from "../sdk/types";

/** Provide deterministic, offline HTTP responses for plugin development and tests. */
export function createReplayHttp(fixtures: Readonly<Record<string, CrawlerHttpResponse>>) {
    const requests: CrawlerHttpRequest[] = [];

    return {
        requests,
        async request(request: CrawlerHttpRequest): Promise<CrawlerHttpResponse> {
            requests.push({ ...request, headers: request.headers ? { ...request.headers } : undefined });
            const fixture = fixtures[request.url];
            if (!fixture) {
                throw new CrawlerPlatformError("HTTP_FAILED", `No replay fixture is registered for ${request.url}.`);
            }
            return { ...fixture, headers: { ...fixture.headers } };
        },
    };
}
