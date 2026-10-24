import { it, expect, describe } from "vitest";

import {
    normalizeServiceUrl,
    createUpstreamHeaders,
    resolveApiProxyTarget,
    rewriteApiRedirectLocation,
} from "../electron/api-proxy";

const targets = {
    news: new URL("https://news.likanug.top/"),
    auth: new URL("https://api.likanug.top/"),
};

describe("Electron remote API boundaries", () => {
    it("routes the fixed news API and preserves its query string", () => {
        const result = resolveApiProxyTarget("app://bundle/api/v1/source?id=github&latest=true", targets);

        expect(result).toEqual({
            service: "news",
            url: new URL("https://news.likanug.top/api/v1/source?id=github&latest=true"),
        });
    });

    it("routes only approved authentication API paths", () => {
        expect(resolveApiProxyTarget("app://bundle/__auth-api__/api/me", targets)?.url.href).toBe(
            "https://api.likanug.top/api/me"
        );
        expect(resolveApiProxyTarget("app://bundle/__auth-api__/admin/export", targets)).toBeNull();
        expect(resolveApiProxyTarget("app://bundle/unrestricted?url=https://example.com", targets)).toBeNull();
    });

    it("rejects non-app origins and path traversal", () => {
        expect(resolveApiProxyTarget("https://attacker.example/api/me", targets)).toBeNull();
        expect(resolveApiProxyTarget("app://bundle/api/%2e%2e/private", targets)).toBeNull();
    });

    it("rewrites same-origin redirects and rejects redirects to another service", () => {
        expect(rewriteApiRedirectLocation("/api/v1/health", targets.news.origin, "news")).toBe(
            "app://bundle/api/v1/health"
        );
        expect(rewriteApiRedirectLocation("https://attacker.example/steal", targets.auth.origin, "auth")).toBeNull();
    });

    it("drops renderer cookies and replaces the origin for the selected API", () => {
        const headers = createUpstreamHeaders(
            new Headers({
                Authorization: "Bearer scoped-token",
                Cookie: "session=renderer-cookie",
                Origin: "app://bundle",
                "Content-Type": "application/json",
            }),
            targets.auth.origin
        );

        expect(headers.get("authorization")).toBe("Bearer scoped-token");
        expect(headers.get("cookie")).toBeNull();
        expect(headers.get("origin")).toBe(targets.auth.origin);
        expect(headers.get("content-type")).toBe("application/json");
    });

    it("allows HTTP only for loopback development services", () => {
        expect(normalizeServiceUrl("https://news.likanug.top", { allowLocalHttp: false }).origin).toBe(
            "https://news.likanug.top"
        );
        expect(() => normalizeServiceUrl("http://localhost:8000", { allowLocalHttp: false })).toThrow();
        expect(normalizeServiceUrl("http://127.0.0.1:8000", { allowLocalHttp: true }).origin).toBe(
            "http://127.0.0.1:8000"
        );
    });

    it("accepts an origin root and rejects credentials, paths, and query values", () => {
        expect(normalizeServiceUrl("https://news.example.com/", { allowLocalHttp: false }).origin).toBe(
            "https://news.example.com"
        );
        expect(() => normalizeServiceUrl("https://user:secret@news.example.com", { allowLocalHttp: false })).toThrow();
        expect(() => normalizeServiceUrl("https://news.example.com/api", { allowLocalHttp: false })).toThrow();
        expect(() => normalizeServiceUrl("https://news.example.com/?tenant=one", { allowLocalHttp: false })).toThrow();
    });
});
