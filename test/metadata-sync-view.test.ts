import { it, expect, describe } from "vitest";

import { getSyncStatusTone, getSyncStatusLabel, getSyncStatusDescription } from "../shared/metadata-sync-view";

describe("metadata sync view policy", () => {
    it("returns pending label when local manual changes exist", () => {
        expect(getSyncStatusLabel("idle", true)).toBe("待同步");
    });

    it("returns merged tone for merge-related phases", () => {
        expect(getSyncStatusTone("merged", false)).toContain("text-cyan-700");
        expect(getSyncStatusTone("conflict-resolved", false)).toContain("text-cyan-700");
    });

    it("returns login prompt description when user is logged out", () => {
        expect(
            getSyncStatusDescription({
                loggedIn: false,
                phase: "idle",
                hasPendingSyncChanges: false,
                lastSynced: null,
                lastAttempt: null,
            })
        ).toBe("登录后可在多端同步布局配置");
    });

    it("returns success description with relative time", () => {
        expect(
            getSyncStatusDescription({
                loggedIn: true,
                phase: "success",
                hasPendingSyncChanges: false,
                lastSynced: "3 分钟前",
                lastAttempt: null,
            })
        ).toBe("最近同步 3 分钟前");
    });
});
