import assert from "node:assert/strict";

import type { OnlineSample } from "./article-online-worker";

export interface SlotResult {
    role: "write" | "read";
    rate: number;
    slots: number;
    skipped: number;
    samples: OnlineSample[];
}

/** Reject malformed or truncated child results before any acceptance decision. */
export function validateSlotResult(result: SlotResult, role: SlotResult["role"], rate: number, seconds: number) {
    const expected = rate * seconds;
    assert.equal(result.role, role, "Unexpected worker role");
    assert.equal(result.rate, rate, "Unexpected worker rate");
    assert.equal(result.slots, expected, "Unexpected offered slot count");
    assert(Number.isSafeInteger(result.skipped) && result.skipped >= 0, "Invalid skipped count");
    assert(Array.isArray(result.samples), "Missing worker samples");
    assert.equal(result.samples.length + result.skipped, expected, "Worker result does not account for all slots");
    let previous = -1;
    for (const sample of result.samples) {
        assert(
            Number.isSafeInteger(sample.sequence) && sample.sequence > previous && sample.sequence < expected,
            "Invalid or repeated worker sequence"
        );
        assert(typeof sample.ok === "boolean", "Invalid worker outcome");
        assert(Number.isSafeInteger(sample.retries) && sample.retries >= 0, "Invalid retry count");
        assert(
            [sample.durationMs, sample.schedulingLagMs, sample.startedAt, sample.endedAt].every(
                (x) => typeof x === "number" && Number.isFinite(x) && x >= 0
            ),
            "Invalid worker timing"
        );
        previous = sample.sequence;
    }
}

export function slotExpired(now: number, due: number, interval: number, endAt: number) {
    return now >= Math.min(due + interval, endAt);
}

export interface AcceptanceInput {
    writes: { completed: number; slots: number; skipped: number; errors: number };
    reads: { completed: number; slots: number; skipped: number; errors: number };
    maintenance: { failed: number; unavailable: number; interrupted: number };
    correctnessPassed: boolean;
    drained: boolean;
    completedRecoveries: number;
    plannedRecoveries: number;
}

/** A valid final index does not imply an accepted offered load or recovery cadence. */
export function evaluateOnlineAcceptance(input: AcceptanceInput) {
    const { writes, reads, maintenance } = input;
    const operationalPassed =
        writes.errors === 0 &&
        reads.errors === 0 &&
        maintenance.failed === 0 &&
        maintenance.unavailable === 0 &&
        maintenance.interrupted === 0 &&
        input.drained;
    const loadCompleted =
        writes.skipped === 0 &&
        reads.skipped === 0 &&
        writes.completed === writes.slots &&
        reads.completed === reads.slots;
    const recoveryCompleted = input.completedRecoveries === input.plannedRecoveries;
    const result =
        !input.correctnessPassed || !operationalPassed
            ? "failed"
            : loadCompleted && recoveryCompleted
              ? "passed"
              : "incomplete-load";
    return { result, correctnessPassed: input.correctnessPassed, operationalPassed, loadCompleted, recoveryCompleted };
}
