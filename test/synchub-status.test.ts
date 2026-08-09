import { it, expect, describe } from "vitest";

import {
    sanitizeSyncHubError,
    toSyncHubPendingStatus,
    toSyncHubSyncingStatus,
    createDefaultSyncHubStatus,
    toSyncHubUploadResultStatus,
} from "../shared/synchub-status";

describe("SyncHub status policy", () => {
    it("deduplicates pending collections in contract order", () => {
        const first = toSyncHubPendingStatus(createDefaultSyncHubStatus(), ["preferences", "favorites"], "auto-upload");
        const second = toSyncHubPendingStatus(first, ["reading-history", "favorites"], "auto-upload");

        expect(second).toMatchObject({
            phase: "pending",
            pendingCollections: ["reading-history", "favorites", "preferences"],
        });
    });

    it("moves a successful batch through syncing to success", () => {
        const pending = toSyncHubPendingStatus(createDefaultSyncHubStatus(), ["favorites"], "auto-upload");
        const syncing = toSyncHubSyncingStatus(pending, ["favorites"], "auto-upload", 100);
        const success = toSyncHubUploadResultStatus(syncing, ["favorites"], [], "auto-upload", undefined, 200);

        expect(syncing).toMatchObject({ phase: "syncing", lastAttemptAt: 100 });
        expect(success).toMatchObject({
            phase: "success",
            pendingCollections: [],
            lastAttemptAt: 200,
            lastSyncedAt: 200,
        });
    });

    it("retains failed collections and keeps successful progress", () => {
        const pending = toSyncHubPendingStatus(
            createDefaultSyncHubStatus(),
            ["reading-history", "favorites"],
            "auto-upload"
        );
        const result = toSyncHubUploadResultStatus(
            pending,
            ["reading-history", "favorites"],
            ["favorites"],
            "auto-upload",
            new Error("network request failed"),
            300
        );

        expect(result).toMatchObject({
            phase: "error",
            pendingCollections: ["favorites"],
            lastSyncedAt: 300,
            lastErrorMessage: "无法连接 SyncHub，请检查网络和服务地址",
        });
    });

    it("re-queues an error when new local changes arrive", () => {
        const failed = toSyncHubUploadResultStatus(
            toSyncHubPendingStatus(createDefaultSyncHubStatus(), ["favorites"], "auto-upload"),
            ["favorites"],
            ["favorites"],
            "auto-upload",
            "timeout"
        );

        expect(toSyncHubPendingStatus(failed, ["preferences"], "auto-upload")).toMatchObject({
            phase: "pending",
            pendingCollections: ["favorites", "preferences"],
            lastErrorMessage: undefined,
        });
    });

    it("never exposes API keys or raw response messages", () => {
        expect(sanitizeSyncHubError(new Error("401 invalid api key shk_secret_value"))).toBe(
            "SyncHub 凭据无效，请重新验证 API Key"
        );
        expect(sanitizeSyncHubError(new Error("upstream response: database dump details"))).toBe(
            "SyncHub 同步失败，请稍后重试"
        );
    });
});
