import { it, expect, describe } from "vitest";

import { createUpstreamNodeDiagnostic } from "../server/utils/upstream-node-diagnostics";

import type { SourceHealthSummary } from "../shared/source-health-types";

function createLocalHealth(): SourceHealthSummary {
    return {
        updatedAt: 10,
        total: 4,
        healthy: 2,
        failing: 1,
        idle: 1,
        cacheDegraded: 1,
        sources: [],
    };
}

describe("upstream node diagnostics", () => {
    it("returns the local health summary when no upstream is configured", () => {
        const diagnostic = createUpstreamNodeDiagnostic({
            generatedAt: 20,
            localHealth: createLocalHealth(),
            result: undefined,
        });

        expect(diagnostic.statusCode).toBeUndefined();
        expect(diagnostic.response).toMatchObject({
            data: null,
            meta: {
                configured: false,
                localHealth: {
                    total: 4,
                    healthy: 2,
                    failing: 1,
                    cacheDegraded: 1,
                },
                upstream: { status: "not_configured", circuit: { state: "closed" } },
            },
            errors: [],
        });
    });

    it("keeps local health visible and marks federation degraded when the circuit is open", () => {
        const diagnostic = createUpstreamNodeDiagnostic({
            generatedAt: 20,
            localHealth: createLocalHealth(),
            result: {
                ok: false,
                attempts: 0,
                code: "federation_circuit_open",
                message: "Upstream node is temporarily quarantined.",
                retriable: true,
                circuit: {
                    state: "open",
                    consecutiveFailures: 3,
                    nextProbeAt: 30_020,
                },
            },
        });

        expect(diagnostic.statusCode).toBe(503);
        expect(diagnostic.response).toMatchObject({
            data: null,
            meta: {
                configured: true,
                localHealth: { total: 4, failing: 1 },
                upstream: {
                    status: "degraded",
                    circuit: { state: "open", consecutiveFailures: 3 },
                },
            },
            errors: [{ code: "federation_circuit_open", retriable: true }],
        });
    });
});
