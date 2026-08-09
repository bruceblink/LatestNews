import type { SourceHealthSummary } from "@shared/source-health-types";
import type { UpstreamNodeManifestResult } from "#/utils/upstream-node-client";
import type { LocalSourceHealthSummary, UpstreamNodeManifestApiResponse } from "@shared/upstream-node-federation";

import { createClosedUpstreamCircuitSnapshot } from "@shared/upstream-node-federation";

export interface CreateUpstreamNodeDiagnosticOptions {
    generatedAt: number;
    localHealth: SourceHealthSummary;
    result: UpstreamNodeManifestResult | undefined;
}

export interface UpstreamNodeDiagnostic {
    response: UpstreamNodeManifestApiResponse;
    statusCode?: number;
}

/**
 * Builds the public upstream diagnostic envelope while preserving local health on every failure path.
 * Remote manifest data stays separate, so an upstream outage cannot be mistaken for empty local sources.
 */
export function createUpstreamNodeDiagnostic(options: CreateUpstreamNodeDiagnosticOptions): UpstreamNodeDiagnostic {
    const localHealth = toLocalHealthSummary(options.localHealth);
    const result = options.result;

    if (!result) {
        return {
            response: {
                data: null,
                meta: {
                    attempts: 0,
                    configured: false,
                    generatedAt: options.generatedAt,
                    localHealth,
                    upstream: {
                        status: "not_configured",
                        circuit: createClosedUpstreamCircuitSnapshot(),
                    },
                },
                errors: [],
            },
        };
    }

    if (!result.ok) {
        return {
            statusCode: getFederationStatusCode(result.code),
            response: {
                data: null,
                meta: {
                    attempts: result.attempts,
                    configured: true,
                    generatedAt: options.generatedAt,
                    localHealth,
                    upstream: {
                        status: "degraded",
                        circuit: result.circuit ?? createClosedUpstreamCircuitSnapshot(),
                    },
                },
                errors: [
                    {
                        code: result.code,
                        message: result.message,
                        retriable: result.retriable,
                    },
                ],
            },
        };
    }

    return {
        response: {
            data: result.manifest.manifest.data,
            meta: {
                attempts: result.attempts,
                configured: true,
                generatedAt: options.generatedAt,
                localHealth,
                upstream: {
                    status: "healthy",
                    circuit: result.circuit ?? createClosedUpstreamCircuitSnapshot(),
                },
                upstreamNodeId: result.manifest.manifest.data.node.id,
            },
            errors: [],
        },
    };
}

function toLocalHealthSummary(summary: SourceHealthSummary): LocalSourceHealthSummary {
    return {
        updatedAt: summary.updatedAt,
        total: summary.total,
        healthy: summary.healthy,
        failing: summary.failing,
        idle: summary.idle,
        cacheDegraded: summary.cacheDegraded,
    };
}

function getFederationStatusCode(code: UpstreamNodeManifestApiResponse["errors"][number]["code"]) {
    if (code === "federation_endpoint_rejected") return 400;
    if (code === "federation_manifest_invalid") return 502;
    if (code === "federation_protocol_unsupported") return 426;
    if (code === "federation_upstream_timeout") return 504;
    return 503;
}
