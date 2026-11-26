import { it, expect, describe } from "vitest";

import { slotExpired, validateSlotResult, evaluateOnlineAcceptance } from "../scripts/performance/article-online-gate";

const sample = (sequence: number) => ({
    sequence,
    startedAt: 1000 + sequence,
    endedAt: 1010 + sequence,
    durationMs: 10,
    schedulingLagMs: 0,
    retries: 0,
    ok: true,
});

describe("online workload gate", () => {
    it("does not execute an expired slot after a late timer wakeup", () => {
        expect(slotExpired(1499, 1000, 500, 2000)).toBe(false);
        expect(slotExpired(1500, 1000, 500, 2000)).toBe(true);
        expect(slotExpired(2000, 1750, 500, 2000)).toBe(true);
    });
    it("requires all planned slots, accounting for each omitted sample", () => {
        const result = {
            role: "read" as const,
            rate: 2,
            slots: 4,
            skipped: 1,
            samples: [sample(0), sample(1), sample(3)],
        };
        expect(() => validateSlotResult(result, "read", 2, 2)).not.toThrow();
        expect(() => validateSlotResult({ ...result, slots: 3 }, "read", 2, 2)).toThrow();
        expect(() => validateSlotResult({ ...result, skipped: 0 }, "read", 2, 2)).toThrow();
        expect(() =>
            validateSlotResult({ ...result, samples: [sample(0), sample(1), sample(1)] }, "read", 2, 2)
        ).toThrow();
        expect(() =>
            validateSlotResult({ ...result, samples: [sample(0), sample(1), sample(4)] }, "read", 2, 2)
        ).toThrow();
        expect(() =>
            validateSlotResult(
                { ...result, samples: [sample(0), sample(1), { ...sample(3), durationMs: Infinity }] },
                "read",
                2,
                2
            )
        ).toThrow();
    });
    it("separates integrity, operational errors, skipped load and recovery cadence", () => {
        const input = {
            writes: { completed: 4, slots: 4, skipped: 0, errors: 0 },
            reads: { completed: 8, slots: 8, skipped: 0, errors: 0 },
            maintenance: { failed: 0, unavailable: 0, interrupted: 0 },
            correctnessPassed: true,
            drained: true,
            completedRecoveries: 2,
            plannedRecoveries: 2,
        };
        expect(evaluateOnlineAcceptance(input)).toMatchObject({ result: "passed", correctnessPassed: true });
        expect(
            evaluateOnlineAcceptance({ ...input, maintenance: { ...input.maintenance, unavailable: 1 } })
        ).toMatchObject({ result: "failed", correctnessPassed: true, operationalPassed: false });
        expect(evaluateOnlineAcceptance({ ...input, drained: false }).result).toBe("failed");
        expect(evaluateOnlineAcceptance({ ...input, correctnessPassed: false }).result).toBe("failed");
        expect(evaluateOnlineAcceptance({ ...input, completedRecoveries: 1 })).toMatchObject({
            result: "incomplete-load",
            recoveryCompleted: false,
        });
        expect(
            evaluateOnlineAcceptance({ ...input, writes: { ...input.writes, completed: 3, skipped: 1 } })
        ).toMatchObject({ result: "incomplete-load", loadCompleted: false });
    });
});
