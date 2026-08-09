import type { UpstreamNodeManifestApiResponse } from "@shared/upstream-node-federation";

import { setResponseStatus, defineEventHandler } from "h3";
import { fetchConfiguredUpstreamNodeManifest } from "#/utils/upstream-node-client";

/**
 * Exposes the deployment-configured upstream manifest without accepting a target URL from callers.
 * It is intentionally independent of Feed responses, so an upstream outage cannot hide local news data.
 */
export default defineEventHandler(async (event): Promise<UpstreamNodeManifestApiResponse> => {
    const generatedAt = Date.now();
    const result = await fetchConfiguredUpstreamNodeManifest();

    if (!result) {
        return {
            data: null,
            meta: { attempts: 0, configured: false, generatedAt },
            errors: [],
        };
    }

    if (!result.ok) {
        setResponseStatus(event, getFederationStatusCode(result.code));
        return {
            data: null,
            meta: { attempts: result.attempts, configured: true, generatedAt },
            errors: [
                {
                    code: result.code,
                    message: result.message,
                    retriable: result.retriable,
                },
            ],
        };
    }

    return {
        data: result.manifest.manifest.data,
        meta: {
            attempts: result.attempts,
            configured: true,
            generatedAt,
            upstreamNodeId: result.manifest.manifest.data.node.id,
        },
        errors: [],
    };
});

function getFederationStatusCode(code: UpstreamNodeManifestApiResponse["errors"][number]["code"]) {
    if (code === "federation_endpoint_rejected") return 400;
    if (code === "federation_manifest_invalid") return 502;
    if (code === "federation_protocol_unsupported") return 426;
    if (code === "federation_upstream_timeout") return 504;
    return 503;
}
