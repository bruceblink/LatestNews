import { it, expect, describe } from "vitest";

import { upstreamCircuitOpenMs, createUpstreamCircuitBreaker } from "../server/utils/upstream-circuit-breaker";

const ORIGIN = "https://news.example.com";

function getPermit(access: ReturnType<ReturnType<typeof createUpstreamCircuitBreaker>["acquire"]>) {
    if (!access.allowed) throw new Error("Expected circuit access to be allowed.");
    return access.permit;
}

describe("upstream circuit breaker", () => {
    it("opens after three retriable failures, admits one half-open probe, and recovers after success", () => {
        let now = 1_000;
        const circuit = createUpstreamCircuitBreaker({ now: () => now });

        for (let attempt = 0; attempt < 3; attempt += 1) {
            circuit.recordFailure(getPermit(circuit.acquire(ORIGIN)), true);
            now += 1;
        }

        expect(circuit.inspect(ORIGIN)).toMatchObject({
            state: "open",
            consecutiveFailures: 3,
            openedAt: 1_002,
            nextProbeAt: 1_002 + upstreamCircuitOpenMs,
        });
        expect(circuit.acquire(ORIGIN)).toMatchObject({ allowed: false, circuit: { state: "open" } });

        now = 1_002 + upstreamCircuitOpenMs;
        const probe = circuit.acquire(ORIGIN);
        expect(probe).toMatchObject({ allowed: true, permit: { isProbe: true }, circuit: { state: "half_open" } });
        expect(circuit.acquire(ORIGIN)).toMatchObject({ allowed: false, circuit: { state: "half_open" } });

        circuit.recordSuccess(getPermit(probe));
        expect(circuit.inspect(ORIGIN)).toMatchObject({
            state: "closed",
            consecutiveFailures: 0,
            lastSuccessAt: now,
        });
        expect(circuit.acquire(ORIGIN)).toMatchObject({ allowed: true, permit: { isProbe: false } });
    });

    it("reopens when its only half-open probe fails", () => {
        let now = 2_000;
        const circuit = createUpstreamCircuitBreaker({ now: () => now, failureThreshold: 1 });

        circuit.recordFailure(getPermit(circuit.acquire(ORIGIN)), true);
        now += upstreamCircuitOpenMs;
        const probe = getPermit(circuit.acquire(ORIGIN));
        circuit.recordFailure(probe, false);

        expect(circuit.inspect(ORIGIN)).toMatchObject({
            state: "open",
            consecutiveFailures: 1,
            openedAt: now,
            nextProbeAt: now + upstreamCircuitOpenMs,
        });
    });
});
