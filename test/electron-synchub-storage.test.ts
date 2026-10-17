import { it, expect, describe } from "vitest";

import { parseStoredSyncHubConfig, serializeStoredSyncHubConfig } from "../electron/synchub-storage";

const validateEndpoint = (endpoint: string) => {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" || url.pathname !== "/") throw new Error("Invalid endpoint");
    return url.origin;
};

describe("Electron encrypted SyncHub payload", () => {
    it("round trips the verified endpoint and API key together", () => {
        const payload = serializeStoredSyncHubConfig("https://sync.example/", "shk_saved-key", validateEndpoint);

        expect(parseStoredSyncHubConfig(payload, validateEndpoint)).toEqual({
            endpoint: "https://sync.example",
            apiKey: "shk_saved-key",
        });
    });

    it("migrates the previous encrypted key-only payload without trusting a renderer endpoint", () => {
        expect(parseStoredSyncHubConfig("shk_legacy-key", validateEndpoint)).toEqual({
            endpoint: null,
            apiKey: "shk_legacy-key",
        });
    });

    it("rejects unknown versions, invalid keys, and unsafe endpoints", () => {
        expect(() => parseStoredSyncHubConfig('{"version":2,"endpoint":null,"apiKey":null}', validateEndpoint)).toThrow(
            "invalid"
        );
        expect(() => serializeStoredSyncHubConfig("https://sync.example", "bad-key", validateEndpoint)).toThrow(
            "API key"
        );
        expect(() => serializeStoredSyncHubConfig("http://sync.example", "shk_saved-key", validateEndpoint)).toThrow(
            "Invalid endpoint"
        );
    });
});
