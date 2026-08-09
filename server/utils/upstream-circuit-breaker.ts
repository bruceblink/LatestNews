import type { UpstreamCircuitSnapshot } from "@shared/upstream-node-federation";

export const upstreamCircuitFailureThreshold = 3;
export const upstreamCircuitOpenMs = 30_000;

interface CircuitEntry {
    consecutiveFailures: number;
    lastFailureAt?: number;
    lastSuccessAt?: number;
    openedAt?: number;
    nextProbeAt?: number;
    probeInFlight: boolean;
}

export interface UpstreamCircuitPermit {
    origin: string;
    isProbe: boolean;
}

export type UpstreamCircuitAccess =
    | {
          allowed: true;
          permit: UpstreamCircuitPermit;
          circuit: UpstreamCircuitSnapshot;
      }
    | {
          allowed: false;
          circuit: UpstreamCircuitSnapshot;
      };

export interface UpstreamCircuitBreaker {
    acquire(origin: string): UpstreamCircuitAccess;
    inspect(origin: string): UpstreamCircuitSnapshot;
    recordFailure(permit: UpstreamCircuitPermit, retriable: boolean): UpstreamCircuitSnapshot;
    recordSuccess(permit: UpstreamCircuitPermit): UpstreamCircuitSnapshot;
}

export interface CreateUpstreamCircuitBreakerOptions {
    failureThreshold?: number;
    now?: () => number;
    openDurationMs?: number;
}

/**
 * Creates the in-memory, per-origin admission guard used before making an upstream request.
 * Three retriable terminal failures open one origin for 30 seconds; only one later half-open probe may close it.
 */
export function createUpstreamCircuitBreaker(
    options: CreateUpstreamCircuitBreakerOptions = {}
): UpstreamCircuitBreaker {
    const now = options.now ?? Date.now;
    const failureThreshold = Math.max(1, options.failureThreshold ?? upstreamCircuitFailureThreshold);
    const openDurationMs = Math.max(1, options.openDurationMs ?? upstreamCircuitOpenMs);
    const entries = new Map<string, CircuitEntry>();

    function getEntry(origin: string): CircuitEntry {
        const existing = entries.get(origin);
        if (existing) return existing;

        const entry: CircuitEntry = { consecutiveFailures: 0, probeInFlight: false };
        entries.set(origin, entry);
        return entry;
    }

    function inspect(origin: string): UpstreamCircuitSnapshot {
        return toSnapshot(getEntry(origin), now());
    }

    function acquire(origin: string): UpstreamCircuitAccess {
        const entry = getEntry(origin);
        const observedAt = now();

        if (!entry.nextProbeAt) {
            return {
                allowed: true,
                permit: { origin, isProbe: false },
                circuit: toSnapshot(entry, observedAt),
            };
        }

        if (observedAt < entry.nextProbeAt) {
            return { allowed: false, circuit: toSnapshot(entry, observedAt) };
        }
        if (entry.probeInFlight) {
            return { allowed: false, circuit: toSnapshot(entry, observedAt) };
        }

        entry.probeInFlight = true;
        return {
            allowed: true,
            permit: { origin, isProbe: true },
            circuit: toSnapshot(entry, observedAt),
        };
    }

    function recordSuccess(permit: UpstreamCircuitPermit): UpstreamCircuitSnapshot {
        const entry = getEntry(permit.origin);
        entry.consecutiveFailures = 0;
        entry.lastSuccessAt = now();
        entry.openedAt = undefined;
        entry.nextProbeAt = undefined;
        entry.probeInFlight = false;
        return toSnapshot(entry, entry.lastSuccessAt);
    }

    function recordFailure(permit: UpstreamCircuitPermit, retriable: boolean): UpstreamCircuitSnapshot {
        const entry = getEntry(permit.origin);
        const failedAt = now();
        entry.lastFailureAt = failedAt;

        // A failed half-open request keeps the origin quarantined, even if its error is not retryable.
        if (permit.isProbe) {
            openCircuit(entry, failedAt, failureThreshold, openDurationMs);
            return toSnapshot(entry, failedAt);
        }

        if (retriable) {
            entry.consecutiveFailures += 1;
            if (entry.consecutiveFailures >= failureThreshold)
                openCircuit(entry, failedAt, failureThreshold, openDurationMs);
        }

        return toSnapshot(entry, failedAt);
    }

    return { acquire, inspect, recordFailure, recordSuccess };
}

function openCircuit(entry: CircuitEntry, openedAt: number, failureThreshold: number, openDurationMs: number) {
    entry.consecutiveFailures = Math.max(entry.consecutiveFailures, failureThreshold);
    entry.openedAt = openedAt;
    entry.nextProbeAt = openedAt + openDurationMs;
    entry.probeInFlight = false;
}

function toSnapshot(entry: CircuitEntry, observedAt: number): UpstreamCircuitSnapshot {
    const state = entry.nextProbeAt ? (observedAt < entry.nextProbeAt ? "open" : "half_open") : "closed";

    return {
        state,
        consecutiveFailures: entry.consecutiveFailures,
        ...(entry.lastFailureAt !== undefined && { lastFailureAt: entry.lastFailureAt }),
        ...(entry.lastSuccessAt !== undefined && { lastSuccessAt: entry.lastSuccessAt }),
        ...(entry.openedAt !== undefined && { openedAt: entry.openedAt }),
        ...(entry.nextProbeAt !== undefined && { nextProbeAt: entry.nextProbeAt }),
    };
}
