import { it, expect, describe } from "vitest";

import { normalizeServiceUrl } from "../electron/api-proxy";
import { parseStoredNewsApiConfig, serializeStoredNewsApiConfig } from "../electron/news-api-storage";

const validate = (value: string) => normalizeServiceUrl(value, { allowLocalHttp: false });

describe("Electron persisted news API configuration", () => {
    it("parses and normalizes a valid origin", () => {
        expect(parseStoredNewsApiConfig('{"url":"https://news.example.com/"}', validate)).toEqual(
            new URL("https://news.example.com")
        );
    });

    it("rejects malformed payloads and unsafe URLs", () => {
        for (const raw of ["not-json", "{}", '{"url":42}', '{"url":"https://news.example.com/api"}']) {
            expect(() => parseStoredNewsApiConfig(raw, validate)).toThrow();
        }
    });

    it("serializes only the validated origin", () => {
        expect(serializeStoredNewsApiConfig(" https://news.example.com/ ", validate)).toBe(
            '{"url":"https://news.example.com"}\n'
        );
        expect(() => serializeStoredNewsApiConfig("http://news.example.com", validate)).toThrow();
    });
});
