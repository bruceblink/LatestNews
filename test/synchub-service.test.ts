import { it, expect, describe } from "vitest";

import {
    syncHubHeaders,
    latestNewsSyncHubURL,
    defaultSyncHubEndpoint,
    normalizeSyncHubEndpoint,
    latestNewsSyncHubCollections,
    verifyLatestNewsSyncHubConnection,
} from "../shared/synchub-contract";

describe("SyncHub service contract", () => {
    it("defaults to the production SyncHub endpoint", async () => {
        expect(defaultSyncHubEndpoint).toBe("https://sync.likanug.app");
        expect(normalizeSyncHubEndpoint("")).toBe(defaultSyncHubEndpoint);
        expect(normalizeSyncHubEndpoint(" https://self-hosted.example/ ")).toBe("https://self-hosted.example");
    });

    it("verifies an application-bound API key before saving", async () => {
        const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
            expect(input).toBe("https://sync.likanug.app/api/v1/metadata/latestnews/favorites");
            expect(init?.headers).toEqual({
                "Content-Type": "application/json",
                "X-API-Key": "shk_latestnews",
            });
            return new Response(JSON.stringify({ code: 0, message: "ok", data: { payload: [] } }), {
                status: 200,
            });
        };

        await expect(verifyLatestNewsSyncHubConnection("", " shk_latestnews ", fetcher)).resolves.toEqual({
            ok: true,
            message: "连接成功，API Key 可用于 LatestNews 同步",
        });
    });

    it("accepts an authenticated empty collection and reports rejected keys", async () => {
        const emptyFetcher = async () =>
            new Response(JSON.stringify({ code: "NOT_FOUND", message: "metadata document not found" }), {
                status: 404,
            });
        await expect(
            verifyLatestNewsSyncHubConnection("https://sync.example/", "shk_valid", emptyFetcher)
        ).resolves.toMatchObject({ ok: true });

        const rejectedFetcher = async () =>
            new Response(JSON.stringify({ code: "UNAUTHENTICATED", message: "invalid api key" }), {
                status: 401,
            });
        await expect(verifyLatestNewsSyncHubConnection("", "shk_rejected", rejectedFetcher)).resolves.toEqual({
            ok: false,
            message: "invalid api key",
        });
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
