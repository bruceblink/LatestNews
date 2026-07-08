import type { SourceHealthSummary } from "@shared/source-health-types";

import { it, expect, describe } from "vitest";

import { createNodeManifestResponse } from "../shared/node-manifest";
import { createSourceMetadataResponse } from "../shared/source-metadata";

const NOW = Date.parse("2026-07-08T12:00:00.000Z");

function createHealthSummary(): SourceHealthSummary {
    return {
        updatedAt: NOW,
        total: 3,
        healthy: 1,
        failing: 1,
        idle: 1,
        cacheDegraded: 1,
        sources: [],
    };
}

describe("node manifest", () => {
    it("creates a stable external node manifest with endpoints and summaries", () => {
        const sourceMetadata = createSourceMetadataResponse({
            generatedAt: NOW,
        });
        const response = createNodeManifestResponse({
            appName: "latestnews",
            appVersion: "0.5.2",
            downstreamEndpoint: " https://downstream.example.com ",
            generatedAt: NOW,
            healthSummary: createHealthSummary(),
            homepage: "https://news.example.com",
            nodeId: " node-a ",
            sourceMetadata,
            upstreamEndpoint: "https://upstream.example.com",
        });

        expect(response.data.node).toEqual({
            id: "node-a",
            name: "latestnews",
            version: "0.5.2",
            homepage: "https://news.example.com",
        });
        expect(response.data.endpoints).toEqual({
            node: "/api/v1/node",
            sources: "/api/v1/sources",
            sourceItems: "/api/v1/sources/{id}/items",
            sourceBatch: "/api/v1/sources/batch",
            sourceHealth: "/api/v1/health/sources",
            deploymentHealth: "/api/v1/health/deployment",
            jsonFeed: "/api/v1/feeds/json",
            rssFeed: "/api/v1/feeds/rss",
        });
        expect(response.data.connections).toEqual({
            upstreamEndpoint: "https://upstream.example.com",
            downstreamEndpoint: "https://downstream.example.com",
        });
        expect(response.data.summary.sourceCount).toBe(sourceMetadata.meta.sourceCount);
        expect(response.data.health).toEqual({
            updatedAt: NOW,
            total: 3,
            healthy: 1,
            failing: 1,
            idle: 1,
            cacheDegraded: 1,
        });
        expect(response.meta.generatedAt).toBe(NOW);
        expect(response.errors).toEqual([]);
    });

    it("falls back to app name as node id and omits empty connection endpoints", () => {
        const response = createNodeManifestResponse({
            appName: "latestnews",
            appVersion: "0.5.2",
            downstreamEndpoint: " ",
            generatedAt: NOW,
            healthSummary: createHealthSummary(),
            nodeId: " ",
            sourceMetadata: createSourceMetadataResponse({
                generatedAt: NOW,
            }),
            upstreamEndpoint: "",
        });

        expect(response.data.node.id).toBe("latestnews");
        expect(response.data.node).not.toHaveProperty("homepage");
        expect(response.data.connections).toEqual({});
    });
});
