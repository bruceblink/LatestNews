import { it, expect, describe } from "vitest";

import { resolveNewsApiBaseUrl } from "../shared/news-api-url";

describe("news API URL", () => {
    it("defaults to same-origin API paths and keeps desktop on the main-process proxy", () => {
        expect(resolveNewsApiBaseUrl()).toBe("/api");
        expect(resolveNewsApiBaseUrl("https://api.example.test", true)).toBe("/api");
    });

    it("accepts an HTTPS API origin for a Pages-hosted web client", () => {
        expect(resolveNewsApiBaseUrl(" https://api.example.test/ ")).toBe("https://api.example.test/api");
        expect(resolveNewsApiBaseUrl("http://localhost:4444")).toBe("http://localhost:4444/api");
    });

    it("rejects URLs that could redirect API requests to an unexpected origin or path", () => {
        for (const value of [
            "not a URL",
            "http://api.example.test",
            "https://user:secret@api.example.test",
            "https://api.example.test/private",
            "https://api.example.test?token=secret",
        ]) {
            expect(() => resolveNewsApiBaseUrl(value)).toThrow("VITE_NEWS_API_URL");
        }
    });
});
