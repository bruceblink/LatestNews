import { it, expect, describe } from "vitest";

import { toErrorStatus, toSuccessStatus, toSyncingStatus } from "../shared/metadata-sync-flow";

describe("metadata sync flow policy", () => {
    it("transitions to syncing and clears error", () => {
        const next = toSyncingStatus(
            {
                phase: "error",
                lastErrorMessage: "failed",
                lastAttemptAt: 1,
            },
            100
        );

        expect(next.phase).toBe("syncing");
        expect(next.lastAttemptAt).toBe(100);
        expect(next.lastErrorMessage).toBeUndefined();
    });

    it("transitions to success and updates synced timestamp", () => {
        const next = toSuccessStatus(
            {
                phase: "syncing",
                lastAttemptAt: 1,
            },
            200
        );

        expect(next.phase).toBe("success");
        expect(next.lastAttemptAt).toBe(200);
        expect(next.lastSyncedAt).toBe(200);
        expect(next.lastErrorMessage).toBeUndefined();
    });

    it("transitions to error with message", () => {
        const next = toErrorStatus(
            {
                phase: "syncing",
                lastAttemptAt: 1,
            },
            "timeout",
            300
        );

        expect(next.phase).toBe("error");
        expect(next.lastAttemptAt).toBe(300);
        expect(next.lastErrorMessage).toBe("timeout");
    });
});
