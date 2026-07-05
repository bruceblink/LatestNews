import type { SourceID, SourceResponse } from "@shared/types";
import type { EntireSourcesResponse } from "@shared/source-api";

import { it, expect, describe } from "vitest";

import { resolveSourceBatchSelection } from "../shared/source-batch";
import { createSourceBatchResponse } from "../shared/source-batch-response";

const NOW = Date.parse("2026-07-05T08:00:00.000Z");

function createResponse(id: SourceID): SourceResponse {
    return {
        id,
        name: id,
        status: "success",
        updatedTime: NOW,
        items: [
            {
                id: `${id}-old`,
                title: "old",
                url: `https://example.com/${id}/old`,
                pubDate: NOW - 1000,
            },
            {
                id: `${id}-new`,
                title: "new",
                url: `https://example.com/${id}/new`,
                pubDate: NOW + 1000,
            },
        ],
    };
}

function createEnvelope(data: SourceResponse[]): EntireSourcesResponse {
    return {
        data,
        meta: {
            generatedAt: NOW,
            requestedSourceCount: data.length,
            resolvedSourceCount: data.length,
            partial: false,
            omittedSourceIds: [],
        },
        errors: [],
    };
}

describe("source batch helpers", () => {
    it("resolves explicit source ids and redirects while reporting invalid ids", () => {
        const result = resolveSourceBatchSelection({
            sources: ["weibo", "v2ex", "missing-source"],
        });

        expect(result.sourceIds).toContain("weibo");
        expect(result.sourceIds).toContain("v2ex-share");
        expect(result.invalidSourceIds).toEqual(["missing-source"]);
        expect(result.filterErrors).toEqual([]);
    });

    it("resolves column and type selectors into source ids", () => {
        const result = resolveSourceBatchSelection({
            column: "finance",
            type: "hottest",
        });

        expect(result.sourceIds.length).toBeGreaterThan(0);
        expect(result.sourceIds).toContain("weibo");
        expect(result.invalidSourceIds).toEqual([]);
        expect(result.filterErrors).toEqual([]);
    });

    it("reports invalid column and type selectors", () => {
        const result = resolveSourceBatchSelection({
            column: "unknown-column",
            type: "unknown-type",
        });

        expect(result.sourceIds).toEqual([]);
        expect(result.filterErrors).toEqual([
            {
                message: "Invalid column filter: unknown-column",
            },
            {
                message: "Invalid type filter: unknown-type",
            },
        ]);
    });

    it("creates a filtered v1 batch response envelope", () => {
        const response = createSourceBatchResponse(
            createEnvelope([createResponse("weibo" as SourceID)]),
            {
                column: "china",
                limit: 1,
                since: NOW,
            },
            ["weibo" as SourceID]
        );

        expect(response.data[0].items.map((item) => item.id)).toEqual(["weibo-new"]);
        expect(response.meta).toMatchObject({
            generatedAt: NOW,
            requestedSourceCount: 1,
            resolvedSourceCount: 1,
            partial: false,
            itemCount: 1,
            unfilteredItemCount: 2,
            filters: {
                sourceIds: ["weibo"],
                columns: ["china"],
                types: [],
                since: NOW,
                limit: 1,
            },
        });
        expect(response.errors).toEqual([]);
    });
});
