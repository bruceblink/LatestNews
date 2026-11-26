import { createApp } from "h3";
import { it, vi, expect, afterEach } from "vitest";

import { logger } from "./utils/logger";
import nodeHandler from "./api/v1/node.get";
import insightsHandler from "./api/v1/insights.post";
import batchHandler from "./api/v1/sources/batch.post";
import healthHandler from "./api/v1/health/sources.get";
import deploymentHandler from "./api/v1/health/deployment.get";
import upstreamHandler from "./api/v1/federation/upstream.get";
import { getSourceHealthSummary } from "./utils/source-health";
import diagnosticsHandler from "./api/v1/health/diagnostics.get";
import sourceItemsHandler from "./api/v1/sources/[id]/items.get";
import { CrawlerPlatformError } from "../crawler-platform/core/errors";

const { legacy, plugin, configured, append } = vi.hoisted(() => ({
    legacy: vi.fn(),
    plugin: vi.fn(),
    configured: vi.fn(),
    append: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("#/getters", () => ({ getters: { weibo: legacy } }));
vi.mock("#/utils/crawler-plugin-runtime", () => ({
    initializeCrawlerPluginCatalog: () => [],
    getCrawlerSourceKind: (id: string) => (id === "v2ex-share" ? "plugin" : id === "ithome" ? "configured" : undefined),
    fetchInstalledCrawlerSource: plugin,
    fetchConfiguredSource: configured,
    disposeCrawlerPluginRuntime: vi.fn(),
}));
vi.mock("#/database/source-health-events", () => ({ getSourceHealthEventsTable: async () => ({ append }) }));
vi.mock("#/database/cache", () => ({ getCacheTable: async () => undefined }));
vi.mock("#/utils/upstream-node-client", () => ({ fetchConfiguredUpstreamNodeManifest: async () => undefined }));

afterEach(() => vi.restoreAllMocks());

it("N3-G1: source failures remain classified across adapters, API, health, persistence and logs", async () => {
    const marker = "AUDIT_SYNTHETIC_NOT_A_SECRET";
    const raw = "https://example.test/?token=" + marker + " /internal/path " + marker;
    legacy.mockRejectedValue(new Error(raw, { cause: new Error(marker) }));
    plugin.mockRejectedValue(new CrawlerPlatformError("TIMEOUT", raw));
    configured.mockRejectedValue(
        Object.assign(new Error(raw), { statusCode: 503, data: { marker }, headers: { authorization: marker } })
    );
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const error = vi.spyOn(logger, "error").mockImplementation(() => {});

    const app = createApp();
    app.post("/api/v1/sources/batch", batchHandler);
    app.post("/api/v1/insights", insightsHandler);
    app.get("/api/v1/health/sources", healthHandler);
    app.get("/api/v1/health/diagnostics", diagnosticsHandler);
    app.get("/api/v1/health/deployment", deploymentHandler);
    app.get("/api/v1/node", nodeHandler);
    app.get("/api/v1/federation/upstream", upstreamHandler);
    app.get("/api/v1/sources/:id/items", sourceItemsHandler);
    const post = async (path: string) =>
        app.request(path, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ sources: ["weibo", "v2ex-share", "ithome"] }),
        });
    for (const path of ["/api/v1/sources/batch", "/api/v1/insights"]) {
        const response = await post(path);
        expect(response.status).toBe(200);
        const text = await response.text();
        expect(text).not.toContain(marker);
        const payload = JSON.parse(text);
        expect(payload.meta.partial).toBe(true);
        expect(payload.errors).toEqual(
            expect.arrayContaining([
                { sourceId: "weibo", code: "UNKNOWN", message: "Source collection failed." },
                { sourceId: "v2ex-share", code: "TIMEOUT", message: "Source collection timed out." },
                { sourceId: "ithome", code: "HTTP_FAILED", message: "HTTP 503" },
            ])
        );
    }
    for (const path of [
        "/api/v1/health/sources",
        "/api/v1/health/diagnostics",
        "/api/v1/health/diagnostics?format=text",
        "/api/v1/health/deployment",
        "/api/v1/node",
        "/api/v1/federation/upstream",
    ]) {
        const response = await app.request(path);
        expect(response.status).toBe(200);
        expect(await response.text()).not.toContain(marker);
    }
    const single = await app.request("/api/v1/sources/ithome/items");
    expect(single.status).toBe(503);
    expect(await single.text()).not.toContain(marker);
    expect((await app.request("/api/v1/sources/missing-source/items")).status).toBe(400);
    expect(
        getSourceHealthSummary()
            .sources.filter((x) => ["weibo", "v2ex-share", "ithome"].includes(x.id))
            .every((x) => x.status === "failing")
    ).toBe(true);
    expect(JSON.stringify(getSourceHealthSummary())).not.toContain(marker);
    expect(append.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(append.mock.calls)).not.toContain(marker);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(marker);
    expect(JSON.stringify(error.mock.calls)).not.toContain(marker);
});
