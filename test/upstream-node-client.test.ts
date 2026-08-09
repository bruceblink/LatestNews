import { it, vi, expect, describe } from "vitest";

import { createUpstreamCircuitBreaker } from "../server/utils/upstream-circuit-breaker";
import {
    isPublicInternetAddress,
    parseUpstreamNodeManifest,
    validateUpstreamNodeEndpoint,
} from "../shared/upstream-node-federation";
import {
    getFederationRetryDelay,
    fetchUpstreamNodeManifest,
    fetchConfiguredUpstreamNodeManifest,
} from "../server/utils/upstream-node-client";

function createManifest(overrides: Record<string, unknown> = {}) {
    return {
        data: {
            node: {
                id: "news-a",
                name: "LatestNews A",
                version: "0.5.2",
            },
            endpoints: {
                node: "/api/v1/node",
                sources: "/api/v1/sources",
                sourceHealth: "/api/v1/health/sources",
            },
            sources: [],
            columns: [],
            summary: {
                sourceCount: 0,
                redirectCount: 0,
                disabledCount: 0,
                columnCount: 0,
            },
            health: {
                updatedAt: 1,
                total: 0,
                healthy: 0,
                failing: 0,
                idle: 0,
                cacheDegraded: 0,
            },
        },
        meta: { generatedAt: 1 },
        errors: [],
        ...overrides,
    };
}

describe("upstream node endpoint policy", () => {
    it("accepts a public HTTPS origin and fixes the manifest path", () => {
        expect(validateUpstreamNodeEndpoint(" https://news.example.com/ ")).toEqual({
            hostname: "news.example.com",
            origin: "https://news.example.com",
            manifestUrl: "https://news.example.com/api/v1/node",
        });
    });

    it("rejects non-origin, local, credentialed, and non-HTTPS endpoints", () => {
        const invalidEndpoints = [
            "http://news.example.com",
            "https://news.example.com:8443",
            "https://news.example.com/other",
            "https://news.example.com/?next=/api/v1/node",
            "https://user:secret@news.example.com",
            "https://localhost",
            "https://127.0.0.1",
            "https://[::1]",
        ];

        for (const endpoint of invalidEndpoints) {
            expect(validateUpstreamNodeEndpoint(endpoint)).toBeUndefined();
        }
        expect(validateUpstreamNodeEndpoint("http://news.example.com", { allowHttp: true })?.origin).toBe(
            "http://news.example.com"
        );
    });

    it("rejects DNS answers for local and reserved networks", () => {
        for (const address of [
            "0.0.0.0",
            "10.1.2.3",
            "100.64.0.1",
            "127.0.0.1",
            "169.254.1.1",
            "172.16.0.1",
            "192.168.1.1",
            "198.51.100.3",
            "203.0.113.4",
            "224.0.0.1",
            "::1",
            "fc00::1",
            "fe80::1",
            "2001:db8::1",
        ]) {
            expect(isPublicInternetAddress(address)).toBe(false);
        }
        expect(isPublicInternetAddress("1.1.1.1")).toBe(true);
        expect(isPublicInternetAddress("2606:4700:4700::1111")).toBe(true);
    });
});

describe("upstream node manifest client", () => {
    it("uses fixed headers and returns a parsed manifest after public DNS validation", async () => {
        const fetcher = vi.fn(async () => new Response(JSON.stringify(createManifest())));

        const result = await fetchUpstreamNodeManifest({
            endpoint: "https://news.example.com",
            fetcher,
            resolveHostname: async () => ["1.1.1.1"],
            token: "federation-secret",
        });

        expect(result).toMatchObject({
            ok: true,
            attempts: 1,
            manifest: { manifest: { data: { node: { id: "news-a" } } } },
        });
        expect(fetcher).toHaveBeenCalledWith(
            "https://news.example.com/api/v1/node",
            expect.objectContaining({
                method: "GET",
                redirect: "manual",
                headers: {
                    Accept: "application/json",
                    Authorization: "Bearer federation-secret",
                    "User-Agent": "LatestNews-Node-Federation/1.0",
                },
            })
        );
    });

    it("blocks a DNS rebinding result before it calls fetch", async () => {
        const fetcher = vi.fn();

        const result = await fetchUpstreamNodeManifest({
            endpoint: "https://news.example.com",
            fetcher,
            resolveHostname: async () => ["127.0.0.1"],
        });

        expect(result).toMatchObject({ ok: false, attempts: 0, code: "federation_endpoint_rejected" });
        expect(fetcher).not.toHaveBeenCalled();
    });

    it("rejects redirects, non-JSON responses, and incomplete manifests", async () => {
        const resolveHostname = async () => ["1.1.1.1"];
        const redirect = await fetchUpstreamNodeManifest({
            endpoint: "https://news.example.com",
            fetcher: async () => new Response(null, { status: 302 }),
            resolveHostname,
        });
        const nonJson = await fetchUpstreamNodeManifest({
            endpoint: "https://news.example.com",
            fetcher: async () => new Response("not json"),
            resolveHostname,
        });
        const incomplete = await fetchUpstreamNodeManifest({
            endpoint: "https://news.example.com",
            fetcher: async () => new Response(JSON.stringify({ data: {} })),
            resolveHostname,
        });

        expect(redirect).toMatchObject({ ok: false, code: "federation_manifest_invalid" });
        expect(nonJson).toMatchObject({ ok: false, code: "federation_manifest_invalid" });
        expect(incomplete).toMatchObject({ ok: false, code: "federation_manifest_invalid" });
    });

    it("does not retry a 5xx response after receiving upstream headers", async () => {
        const fetcher = vi.fn(async () => new Response("unavailable", { status: 503 }));

        const result = await fetchUpstreamNodeManifest({
            endpoint: "https://news.example.com",
            fetcher,
            resolveHostname: async () => ["1.1.1.1"],
        });

        expect(result).toMatchObject({
            ok: false,
            attempts: 1,
            code: "federation_upstream_unavailable",
            retriable: true,
        });
        expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it("retries a connection failure once and succeeds without expanding the retry budget", async () => {
        const fetcher = vi
            .fn()
            .mockRejectedValueOnce(new Error("reset"))
            .mockResolvedValueOnce(new Response(JSON.stringify(createManifest())));
        const retryDelay = vi.fn(async () => undefined);

        const result = await fetchUpstreamNodeManifest({
            endpoint: "https://news.example.com",
            fetcher,
            random: () => 0.5,
            resolveHostname: async () => ["1.1.1.1"],
            retryDelay,
        });

        expect(result).toMatchObject({ ok: true, attempts: 2 });
        expect(fetcher).toHaveBeenCalledTimes(2);
        expect(retryDelay).toHaveBeenCalledWith(250);
    });

    it("quarantines an origin after three terminal transient failures without counting retry attempts twice", async () => {
        let now = 1_000;
        const circuitBreaker = createUpstreamCircuitBreaker({ now: () => now });
        const fetcher = vi.fn(async () => Promise.reject(new Error("reset")));
        const options = {
            endpoint: "https://news.example.com",
            circuitBreaker,
            fetcher,
            random: () => 0.5,
            resolveHostname: async () => ["1.1.1.1"],
            retryDelay: async () => undefined,
        };

        for (let failure = 0; failure < 3; failure += 1) {
            const result = await fetchUpstreamNodeManifest(options);
            expect(result).toMatchObject({
                ok: false,
                attempts: 2,
                code: "federation_upstream_unavailable",
                circuit: { state: failure === 2 ? "open" : "closed", consecutiveFailures: failure + 1 },
            });
            now += 1;
        }

        const blocked = await fetchUpstreamNodeManifest(options);
        expect(blocked).toMatchObject({
            ok: false,
            attempts: 0,
            code: "federation_circuit_open",
            circuit: { state: "open", consecutiveFailures: 3, nextProbeAt: 31_002 },
        });
        expect(fetcher).toHaveBeenCalledTimes(6);
    });

    it("reports timeout and incompatible protocol errors using federation codes", async () => {
        const resolveHostname = async () => ["1.1.1.1"];
        const timeout = await fetchUpstreamNodeManifest({
            endpoint: "https://news.example.com",
            fetcher: async () => new Promise<Response>(() => undefined),
            resolveHostname,
            retryDelay: async () => undefined,
            timeoutMs: 1,
        });
        const incompatible = await fetchUpstreamNodeManifest({
            endpoint: "https://news.example.com",
            fetcher: async () =>
                new Response(
                    JSON.stringify(
                        createManifest({
                            data: {
                                ...createManifest().data,
                                federation: { protocolVersion: "2.0", capabilities: ["source-metadata"] },
                            },
                        })
                    )
                ),
            resolveHostname,
        });

        expect(timeout).toMatchObject({ ok: false, code: "federation_upstream_timeout", retriable: true });
        expect(incompatible).toMatchObject({ ok: false, code: "federation_protocol_unsupported", retriable: false });
    });

    it("uses one shared deadline for DNS resolution and the manifest request", async () => {
        vi.useFakeTimers();
        try {
            const fetcher = vi.fn();
            const pending = fetchUpstreamNodeManifest({
                endpoint: "https://news.example.com",
                fetcher,
                resolveHostname: async () => new Promise<string[]>(() => undefined),
                timeoutMs: 100,
            });

            const assertion = expect(pending).resolves.toMatchObject({
                ok: false,
                attempts: 0,
                code: "federation_upstream_timeout",
            });
            await vi.advanceTimersByTimeAsync(100);
            await assertion;
            expect(fetcher).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    it("only reads the upstream endpoint and bearer token from deployment environment variables", async () => {
        const previousEndpoint = process.env.LATESTNEWS_UPSTREAM_ENDPOINT;
        const previousToken = process.env.LATESTNEWS_FEDERATION_UPSTREAM_TOKEN;
        process.env.LATESTNEWS_UPSTREAM_ENDPOINT = "https://news.example.com";
        process.env.LATESTNEWS_FEDERATION_UPSTREAM_TOKEN = "upstream-token";

        try {
            const fetcher = vi.fn(async () => new Response(JSON.stringify(createManifest())));
            const result = await fetchConfiguredUpstreamNodeManifest({
                fetcher,
                resolveHostname: async () => ["1.1.1.1"],
            });

            expect(result).toMatchObject({ ok: true, attempts: 1 });
            expect(fetcher).toHaveBeenCalledWith(
                "https://news.example.com/api/v1/node",
                expect.objectContaining({
                    headers: expect.objectContaining({ Authorization: "Bearer upstream-token" }),
                })
            );
        } finally {
            if (previousEndpoint === undefined) delete process.env.LATESTNEWS_UPSTREAM_ENDPOINT;
            else process.env.LATESTNEWS_UPSTREAM_ENDPOINT = previousEndpoint;
            if (previousToken === undefined) delete process.env.LATESTNEWS_FEDERATION_UPSTREAM_TOKEN;
            else process.env.LATESTNEWS_FEDERATION_UPSTREAM_TOKEN = previousToken;
        }
    });
});

describe("federation retry delay", () => {
    it("uses bounded exponential backoff with deterministic jitter", () => {
        expect(getFederationRetryDelay(0, () => 0.5)).toBe(250);
        expect(getFederationRetryDelay(1, () => 0.5)).toBe(500);
        expect(getFederationRetryDelay(4, () => 0.5)).toBe(1_000);
        expect(getFederationRetryDelay(0, () => 0)).toBe(125);
        expect(getFederationRetryDelay(0, () => 1)).toBe(375);
    });
});

describe("upstream node manifest parsing", () => {
    it("requires same-origin source and health API paths", () => {
        const invalid = createManifest({
            data: {
                ...createManifest().data,
                endpoints: {
                    ...createManifest().data.endpoints,
                    sources: "https://attacker.example/api/v1/sources",
                },
            },
        });

        expect(parseUpstreamNodeManifest(createManifest())).toBeDefined();
        expect(parseUpstreamNodeManifest(invalid)).toBeUndefined();
    });
});
