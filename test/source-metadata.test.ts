import { it, expect, describe } from "vitest";

import dataSources from "../shared/data-sources";
import { createSourceMetadataResponse } from "../shared/source-metadata";

describe("source metadata", () => {
    it("returns non-redirected source metadata by default", () => {
        const result = createSourceMetadataResponse({
            generatedAt: 1,
        });

        expect(result.meta.generatedAt).toBe(1);
        expect(result.meta.sourceCount).toBe(result.data.sources.length);
        expect(result.data.sources.length).toBeGreaterThan(0);
        expect(result.data.sources.some((source) => source.id === "v2ex")).toBe(false);
        expect(result.data.sources.some((source) => source.id === "v2ex-share")).toBe(true);
        expect(result.data.sources.every((source) => !source.redirectTo)).toBe(true);
        expect(result.data.columns.some((column) => column.id === "tech" && column.sourceIds.length > 0)).toBe(true);
    });

    it("can include redirect aliases for clients that need legacy ids", () => {
        const result = createSourceMetadataResponse({
            generatedAt: 1,
            includeRedirects: true,
        });

        const redirectCount = Object.values(dataSources).filter((source) => source.redirect).length;

        expect(result.meta.redirectCount).toBe(redirectCount);
        expect(result.data.sources.some((source) => source.id === "v2ex" && source.redirectTo === "v2ex-share")).toBe(
            true
        );
    });

    it("exposes source capability fields without item data", () => {
        const result = createSourceMetadataResponse({
            generatedAt: 1,
        });
        const weibo = result.data.sources.find((source) => source.id === "weibo");

        expect(weibo).toMatchObject({
            id: "weibo",
            name: expect.any(String),
            type: "hottest",
            column: "china",
            columnName: expect.any(String),
            interval: expect.any(Number),
            disabled: false,
        });
        expect(weibo).not.toHaveProperty("items");
    });
});
