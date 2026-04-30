import { it, expect, describe } from "vitest";

import { shouldDegradeSourceToCache } from "../shared/source-health-policy";

describe("shouldDegradeSourceToCache", () => {
    it("returns false for healthy source", () => {
        expect(
            shouldDegradeSourceToCache({
                status: "healthy",
                consecutiveFailures: 99,
            })
        ).toBe(false);
    });

    it("returns false for failing source with a single failure", () => {
        expect(
            shouldDegradeSourceToCache({
                status: "failing",
                consecutiveFailures: 1,
            })
        ).toBe(false);
    });

    it("returns true for failing source with two or more failures", () => {
        expect(
            shouldDegradeSourceToCache({
                status: "failing",
                consecutiveFailures: 2,
            })
        ).toBe(true);

        expect(
            shouldDegradeSourceToCache({
                status: "failing",
                consecutiveFailures: 4,
            })
        ).toBe(true);
    });
});
