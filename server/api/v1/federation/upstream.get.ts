import type { UpstreamNodeManifestApiResponse } from "@shared/upstream-node-federation";

import { setResponseStatus, defineEventHandler } from "h3";
import { getSourceHealthSummary } from "#/utils/source-health";
import { createUpstreamNodeDiagnostic } from "#/utils/upstream-node-diagnostics";
import { fetchConfiguredUpstreamNodeManifest } from "#/utils/upstream-node-client";

/**
 * Exposes the deployment-configured upstream manifest without accepting a target URL from callers.
 * It is intentionally independent of Feed responses, so an upstream outage cannot hide local news data.
 */
export default defineEventHandler(async (event): Promise<UpstreamNodeManifestApiResponse> => {
    const generatedAt = Date.now();
    const result = await fetchConfiguredUpstreamNodeManifest();
    const diagnostic = createUpstreamNodeDiagnostic({
        generatedAt,
        localHealth: getSourceHealthSummary(),
        result,
    });

    if (diagnostic.statusCode) setResponseStatus(event, diagnostic.statusCode);
    return diagnostic.response;
});
