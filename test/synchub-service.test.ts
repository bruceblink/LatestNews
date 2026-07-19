import { it, expect, describe } from "vitest";

import {
    syncHubHeaders,
    latestNewsSyncHubURL,
    defaultSyncHubEndpoint,
    normalizeSyncHubEndpoint,
    latestNewsSyncHubCollections,
} from "../shared/synchub-contract";

describe("SyncHub service contract", () => {
    it("defaults to the production SyncHub endpoint", async () => {
        expect(defaultSyncHubEndpoint).toBe("https://sync.likanug.app");
        expect(normalizeSyncHubEndpoint("")).toBe(defaultSyncHubEndpoint);
        expect(normalizeSyncHubEndpoint(" https://self-hosted.example/ ")).toBe("https://self-hosted.example");
    });

    it("uses the LatestNews application route and API key header", async () => {
        expect(latestNewsSyncHubCollections).toEqual(["reading-history", "favorites", "preferences"]);
        expect(latestNewsSyncHubURL("https://sync.likanug.app/", "favorites")).toBe(
            "https://sync.likanug.app/api/v1/metadata/latestnews/favorites"
        );
        expect(syncHubHeaders(" shk_latestnews ")).toEqual({
            "Content-Type": "application/json",
            "X-API-Key": "shk_latestnews",
        });
    });
});
