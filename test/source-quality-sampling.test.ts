import { it, expect, describe } from "vitest";

import { getSourceQualityWatchlistEntry } from "../shared/source-quality-watchlist";
import { sampleSourceQuality, normalizeSourceQualitySampleOrigin } from "../shared/source-quality-sampling";

const source = getSourceQualityWatchlistEntry("freebuf");
if (!source) throw new Error("freebuf must remain in the source quality watchlist");

describe("source quality sampling", () => {
    it("accepts HTTPS origins and localhost HTTP origins only", () => {
        expect(normalizeSourceQualitySampleOrigin("https://news.example.com/")).toBe("https://news.example.com");
        expect(normalizeSourceQualitySampleOrigin("http://127.0.0.1:3000/")).toBe("http://127.0.0.1:3000");
        expect(() => normalizeSourceQualitySampleOrigin("http://news.example.com")).toThrow(/HTTPS/);
        expect(() => normalizeSourceQualitySampleOrigin("https://user:pass@news.example.com")).toThrow(/credentials/);
    });

    it("records item count and freshness from a bounded source response", async () => {
        const sampledAt = Date.parse("2026-10-24T04:00:00.000Z");
        const result = await sampleSourceQuality(source, {
            origin: "http://127.0.0.1:3000",
            now: () => sampledAt,
            fetchImpl: async () =>
                new Response(
                    JSON.stringify({
                        data: {
                            status: "success",
                            items: [
                                { title: "Old", pubDate: sampledAt - 120_000 },
                                { title: "Newest", pubDate: new Date(sampledAt - 30_000).toISOString() },
                            ],
                        },
                    }),
                    { status: 200, headers: { "content-type": "application/json" } }
                ),
        });

        expect(result).toMatchObject({
            sampledAt,
            origin: "http://127.0.0.1:3000",
            sourceId: "freebuf",
            status: "success",
            itemCount: 2,
            newestPublishedAt: sampledAt - 30_000,
            freshnessMs: 30_000,
            httpStatus: 200,
        });
        expect(result.durationMs).toBe(0);
    });

    it("records HTTP failures without retaining the response body", async () => {
        const result = await sampleSourceQuality(source, {
            origin: "http://localhost:3000",
            fetchImpl: async () => new Response("upstream failed", { status: 503 }),
        });

        expect(result).toMatchObject({
            status: "http-error",
            itemCount: 0,
            httpStatus: 503,
            error: "HTTP 503",
        });
    });

    it("returns a bounded response error when the payload exceeds the limit", async () => {
        const result = await sampleSourceQuality(source, {
            origin: "http://localhost:3000",
            maxResponseBytes: 10,
            fetchImpl: async () => new Response("01234567890", { status: 200 }),
        });

        expect(result.status).toBe("error");
        expect(result.error).toContain("exceeds 10 bytes");
    });

    it("maps an aborted request to a timeout record", async () => {
        const result = await sampleSourceQuality(source, {
            origin: "http://localhost:3000",
            timeoutMs: 1,
            fetchImpl: async (_url, init) =>
                await new Promise<Response>((_resolve, reject) => {
                    init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
                }),
        });

        expect(result).toMatchObject({ status: "error", error: "timeout after 1 ms" });
    });
});
