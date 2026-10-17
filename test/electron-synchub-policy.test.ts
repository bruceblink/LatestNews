import { it, expect, describe } from "vitest";

import {
    isSyncHubVerificationSuccessful,
    resolveSyncHubRequestCredentials,
    resolveSyncHubVerificationCredentials,
} from "../electron/synchub-policy";

describe("Electron SyncHub credential boundaries", () => {
    it("reuses a stored API key only for its saved endpoint", () => {
        expect(
            resolveSyncHubVerificationCredentials("https://sync.example/", "https://sync.example", "", "shk_saved-key")
        ).toEqual({ endpoint: "https://sync.example", apiKey: "shk_saved-key" });

        expect(() =>
            resolveSyncHubVerificationCredentials(
                "https://attacker.example",
                "https://sync.example",
                "",
                "shk_saved-key"
            )
        ).toThrow("请重新输入 API Key");
    });

    it("allows an explicitly entered key to verify a new endpoint", () => {
        expect(
            resolveSyncHubVerificationCredentials(
                "https://sync-new.example/",
                "https://sync-old.example",
                "shk_new-key",
                "shk_saved-key"
            )
        ).toEqual({ endpoint: "https://sync-new.example", apiKey: "shk_new-key" });
    });

    it("builds sync requests only from a saved main-process endpoint and key", () => {
        expect(resolveSyncHubRequestCredentials("https://sync.example/", "shk_saved-key")).toEqual({
            endpoint: "https://sync.example",
            apiKey: "shk_saved-key",
        });
        expect(() => resolveSyncHubRequestCredentials(null, "shk_saved-key")).toThrow("验证并保存");
        expect(() => resolveSyncHubRequestCredentials("https://sync.example", null)).toThrow("验证并保存");
    });

    it("accepts successful responses and the known collection-not-found response", () => {
        expect(isSyncHubVerificationSuccessful(204, "")).toBe(true);
        expect(isSyncHubVerificationSuccessful(404, JSON.stringify({ code: "NOT_FOUND" }))).toBe(true);
        expect(isSyncHubVerificationSuccessful(404, JSON.stringify({ code: "AUTH_REQUIRED" }))).toBe(false);
        expect(isSyncHubVerificationSuccessful(503, "{}")).toBe(false);
    });
});
