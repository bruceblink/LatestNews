import { sourceApi } from "./source-api";

export interface OpenApiDocumentOptions {
    title: string;
    version: string;
}

const API_BASE_PATH = "/api";

export function createOpenApiDocument(options: OpenApiDocumentOptions) {
    return {
        openapi: "3.1.0",
        info: {
            title: options.title,
            version: options.version,
            description:
                "Read-oriented LatestNews API for source metadata, source items, feed export, and diagnostics.",
        },
        paths: {
            [withApiPrefix(sourceApi.nodeV1)]: {
                get: {
                    summary: "Get node manifest",
                    tags: ["Node"],
                    responses: okJsonResponse("Node manifest"),
                },
            },
            [withApiPrefix(sourceApi.openApiV1)]: {
                get: {
                    summary: "Get OpenAPI document",
                    tags: ["Node"],
                    responses: okJsonResponse("OpenAPI document"),
                },
            },
            [withApiPrefix(sourceApi.sourcesV1)]: {
                get: {
                    summary: "List source metadata",
                    tags: ["Sources"],
                    responses: okJsonResponse("Source metadata envelope"),
                },
            },
            [`${withApiPrefix(sourceApi.sourcesV1)}/{id}/items`]: {
                get: {
                    summary: "Get source items",
                    tags: ["Sources"],
                    parameters: [
                        pathParameter("id", "Source ID"),
                        queryParameter("since", "Return items at or after this timestamp"),
                        queryParameter("limit", "Maximum item count"),
                        queryParameter("latest", "Prefer live source fetch where supported"),
                        queryParameter("clearCache", "Clear cached items before fetching"),
                    ],
                    responses: okJsonResponse("Source items envelope"),
                },
            },
            [withApiPrefix(sourceApi.sourceBatchV1)]: {
                post: {
                    summary: "Fetch a batch of source responses",
                    tags: ["Sources"],
                    requestBody: {
                        required: true,
                        content: {
                            "application/json": {
                                schema: {
                                    type: "object",
                                    properties: {
                                        sources: { type: "array", items: { type: "string" } },
                                        source: sourceSelectorSchema(),
                                        column: sourceSelectorSchema(),
                                        type: sourceSelectorSchema(),
                                        since: { oneOf: [{ type: "number" }, { type: "string" }] },
                                        limit: { oneOf: [{ type: "number" }, { type: "string" }] },
                                    },
                                },
                            },
                        },
                    },
                    responses: okJsonResponse("Source batch envelope"),
                },
            },
            [withApiPrefix(sourceApi.sourceHealthV1)]: {
                get: {
                    summary: "List source health snapshots",
                    tags: ["Health"],
                    parameters: [
                        queryParameter("status", "all, healthy, failing, idle, or cache-degraded"),
                        queryParameter("keyword", "Search by source name or ID"),
                        queryParameter("q", "Alias of keyword"),
                        queryParameter("limit", "Maximum source count"),
                    ],
                    responses: okJsonResponse("Source health envelope"),
                },
            },
            [withApiPrefix(sourceApi.deploymentHealthV1)]: {
                get: {
                    summary: "Get deployment health",
                    tags: ["Health"],
                    responses: okJsonResponse("Deployment health envelope"),
                },
            },
            [withApiPrefix(sourceApi.sourceHealthDiagnosticsV1)]: {
                get: {
                    summary: "Get source health diagnostics",
                    tags: ["Health"],
                    parameters: [queryParameter("format", "json or text")],
                    responses: {
                        200: {
                            description: "Diagnostics report",
                            content: {
                                "application/json": {
                                    schema: envelopeSchema(),
                                },
                                "text/plain": {
                                    schema: {
                                        type: "string",
                                    },
                                },
                            },
                        },
                    },
                },
            },
            [withApiPrefix(sourceApi.jsonFeedV1)]: {
                get: {
                    summary: "Export JSON Feed",
                    tags: ["Feeds"],
                    parameters: feedQueryParameters(),
                    responses: okJsonResponse("JSON Feed"),
                },
            },
            [withApiPrefix(sourceApi.rssFeedV1)]: {
                get: {
                    summary: "Export RSS",
                    tags: ["Feeds"],
                    parameters: feedQueryParameters(),
                    responses: {
                        200: {
                            description: "RSS feed",
                            content: {
                                "application/rss+xml": {
                                    schema: {
                                        type: "string",
                                    },
                                },
                            },
                        },
                    },
                },
            },
        },
    } as const;
}

function withApiPrefix(path: string) {
    return `${API_BASE_PATH}${path}`;
}

function okJsonResponse(description: string) {
    return {
        200: {
            description,
            content: {
                "application/json": {
                    schema: envelopeSchema(),
                },
            },
        },
    };
}

function envelopeSchema() {
    return {
        type: "object",
        required: ["data", "meta", "errors"],
        properties: {
            data: {},
            meta: {
                type: "object",
            },
            errors: {
                type: "array",
                items: {
                    type: "object",
                },
            },
        },
    };
}

function pathParameter(name: string, description: string) {
    return {
        name,
        in: "path",
        required: true,
        description,
        schema: {
            type: "string",
        },
    };
}

function queryParameter(name: string, description: string) {
    return {
        name,
        in: "query",
        required: false,
        description,
        schema: {
            type: "string",
        },
    };
}

function sourceSelectorSchema() {
    return {
        oneOf: [
            { type: "string" },
            {
                type: "array",
                items: {
                    type: "string",
                },
            },
        ],
    };
}

function feedQueryParameters() {
    return [
        queryParameter("source", "Source ID or repeated source IDs"),
        queryParameter("column", "Column ID"),
        queryParameter("type", "Source type"),
        queryParameter("since", "Return items at or after this timestamp"),
        queryParameter("limit", "Maximum item count"),
    ];
}
