import { it, expect, describe } from "vitest";

import { normalizeServiceUrl } from "../electron/api-proxy";
import { parseStoredNewsApiConfig, serializeStoredNewsApiConfig } from "../electron/news-api-storage";

const validate = (value: string) => normalizeServiceUrl(value, { allowLocalHttp: false });

describe("Electron persisted news API configuration", () => {
    it("parses and normalizes a valid origin", () => {
        expect(parseStoredNewsApiConfig('{"url":"https://news.example.com/"}', validate)).toEqual({
            url: new URL("https://news.example.com"),
            mode: "auto",
        });
    });

    it("reads legacy URL-only configuration as auto mode", () => {
        expect(parseStoredNewsApiConfig('{"url":null}', validate)).toEqual({ url: null, mode: "auto" });
        expect(parseStoredNewsApiConfig('{"url":""}', validate)).toEqual({ url: null, mode: "auto" });
    });

    it("parses local mode with a configured URL and rejects remote mode without one", () => {
        expect(parseStoredNewsApiConfig('{"url":"https://news.example.com","mode":"local"}', validate)).toEqual({
            url: new URL("https://news.example.com"),
            mode: "local",
        });
        expect(() => parseStoredNewsApiConfig('{"url":null,"mode":"remote"}', validate)).toThrow();
        expect(() => parseStoredNewsApiConfig('{"url":null,"mode":"invalid"}', validate)).toThrow();
    });

    it("rejects malformed payloads and unsafe URLs", () => {
        for (const raw of ["not-json", "{}", '{"url":42}', '{"url":"https://news.example.com/api"}']) {
            expect(() => parseStoredNewsApiConfig(raw, validate)).toThrow();
        }
    });

    it("serializes only the validated origin", () => {
        expect(serializeStoredNewsApiConfig(" https://news.example.com/ ", validate)).toBe(
            '{"url":"https://news.example.com","mode":"auto"}\n'
        );
        expect(() => serializeStoredNewsApiConfig("http://news.example.com", validate)).toThrow();
    });

    it("serializes mode independently and rejects remote mode without a URL", () => {
        expect(serializeStoredNewsApiConfig("https://news.example.com", validate, "local")).toBe(
            '{"url":"https://news.example.com","mode":"local"}\n'
        );
        expect(serializeStoredNewsApiConfig(" ", validate, "auto")).toBe('{"url":null,"mode":"auto"}\n');
        expect(() => serializeStoredNewsApiConfig(" ", validate, "remote")).toThrow();
    });
});
