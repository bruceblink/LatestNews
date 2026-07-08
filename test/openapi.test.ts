import { it, expect, describe } from "vitest";

import { createOpenApiDocument } from "../shared/openapi";

describe("OpenAPI document", () => {
    it("describes public v1 API endpoints", () => {
        const document = createOpenApiDocument({
            title: "latestnews",
            version: "0.5.2",
        });

        expect(document.openapi).toBe("3.1.0");
        expect(document.info).toMatchObject({
            title: "latestnews",
            version: "0.5.2",
        });
        expect(Object.keys(document.paths)).toEqual(
            expect.arrayContaining([
                "/api/v1/node",
                "/api/v1/openapi.json",
                "/api/v1/sources",
                "/api/v1/sources/{id}/items",
                "/api/v1/sources/batch",
                "/api/v1/health/sources",
                "/api/v1/health/deployment",
                "/api/v1/health/diagnostics",
                "/api/v1/feeds/json",
                "/api/v1/feeds/rss",
            ])
        );
        const sourceItemsPath = document.paths["/api/v1/sources/{id}/items"];

        expect(sourceItemsPath).toMatchObject({
            get: {
                parameters: expect.arrayContaining([
                    expect.objectContaining({ in: "path", name: "id", required: true }),
                ]),
            },
        });
    });
});
