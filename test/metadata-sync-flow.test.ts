import { it, expect, describe } from "vitest";

import {
    toErrorStatus,
    toMergedStatus,
    toQueuedStatus,
    toSuccessStatus,
    toSyncingStatus,
    toConflictResolvedStatus,
} from "../shared/metadata-sync-flow";

describe("metadata sync flow policy", () => {
    it("transitions to queued and clears error", () => {
        const next = toQueuedStatus(
            {
                phase: "error",
                lastErrorMessage: "failed",
                lastAttemptAt: 1,
            },
            "auto-upload",
            90
        );

        expect(next.phase).toBe("queued");
        expect(next.lastAttemptAt).toBe(90);
        expect(next.lastErrorMessage).toBeUndefined();
        expect(next.lastTransitionSource).toBe("auto-upload");
    });

    it("transitions to syncing and clears error", () => {
        const next = toSyncingStatus(
            {
                phase: "error",
                lastErrorMessage: "failed",
                lastAttemptAt: 1,
            },
            "manual-sync",
            100
        );

        expect(next.phase).toBe("syncing");
        expect(next.lastAttemptAt).toBe(100);
        expect(next.lastErrorMessage).toBeUndefined();
        expect(next.lastTransitionSource).toBe("manual-sync");
    });

    it("transitions to merged", () => {
        const next = toMergedStatus(
            {
                phase: "syncing",
                lastAttemptAt: 1,
            },
            "login-sync"
        );

        expect(next.phase).toBe("merged");
        expect(next.lastTransitionSource).toBe("login-sync");
    });

    it("transitions to conflict-resolved", () => {
        const next = toConflictResolvedStatus(
            {
                phase: "syncing",
                lastAttemptAt: 1,
            },
            "login-sync"
        );

        expect(next.phase).toBe("conflict-resolved");
        expect(next.lastTransitionSource).toBe("login-sync");
    });

    it("transitions to success and updates synced timestamp", () => {
        const next = toSuccessStatus(
            {
                phase: "syncing",
                lastAttemptAt: 1,
            },
            "retry-sync",
            200
        );

        expect(next.phase).toBe("success");
        expect(next.lastAttemptAt).toBe(200);
        expect(next.lastSyncedAt).toBe(200);
        expect(next.lastErrorMessage).toBeUndefined();
        expect(next.lastTransitionSource).toBe("retry-sync");
    });

    it("transitions to error with message", () => {
        const next = toErrorStatus(
            {
                phase: "syncing",
                lastAttemptAt: 1,
            },
            "restore-from-remote",
            "timeout",
            300
        );

        expect(next.phase).toBe("error");
        expect(next.lastAttemptAt).toBe(300);
        expect(next.lastErrorMessage).toBe("timeout");
        expect(next.lastTransitionSource).toBe("restore-from-remote");
    });
});
