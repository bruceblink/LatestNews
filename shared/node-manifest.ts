import { sourceApi } from "./source-api";

import type { SourceApiError } from "./source-api";
import type { SourceMetadataResponse } from "./source-metadata";
import type { SourceHealthSummary } from "./source-health-types";

export interface NodeManifestEndpointMap {
    node: string;
    openApi: string;
    source: string;
    sources: string;
    sourceItems: string;
    sourceBatch: string;
    sourceHealth: string;
    sourceHealthDiagnostics: string;
    deploymentHealth: string;
    jsonFeed: string;
    rssFeed: string;
}

export interface NodeManifestConnectionConfig {
    upstreamEndpoint?: string;
    downstreamEndpoint?: string;
}

export interface NodeManifestResponse {
    data: {
        node: {
            id: string;
            name: string;
            version: string;
            homepage?: string;
        };
        apiBasePath: "/api";
        endpoints: NodeManifestEndpointMap;
        connections: NodeManifestConnectionConfig;
        sources: SourceMetadataResponse["data"]["sources"];
        columns: SourceMetadataResponse["data"]["columns"];
        summary: {
            sourceCount: number;
            redirectCount: number;
            disabledCount: number;
            columnCount: number;
        };
        health: {
            updatedAt: number;
            total: number;
            healthy: number;
            failing: number;
            idle: number;
            cacheDegraded: number;
        };
    };
    meta: {
        generatedAt: number;
    };
    errors: SourceApiError[];
}

export interface CreateNodeManifestOptions {
    appName: string;
    appVersion: string;
    generatedAt: number;
    healthSummary: SourceHealthSummary;
    sourceMetadata: SourceMetadataResponse;
    downstreamEndpoint?: string;
    homepage?: string;
    nodeId?: string;
    upstreamEndpoint?: string;
}

const API_BASE_PATH = "/api";

export function createNodeManifestResponse(options: CreateNodeManifestOptions): NodeManifestResponse {
    return {
        data: {
            node: {
                id: normalizeNodeId(options.nodeId) ?? options.appName,
                name: options.appName,
                version: options.appVersion,
                ...(options.homepage && { homepage: options.homepage }),
            },
            apiBasePath: API_BASE_PATH,
            endpoints: createEndpointMap(),
            connections: createConnectionConfig(options),
            sources: options.sourceMetadata.data.sources,
            columns: options.sourceMetadata.data.columns,
            summary: {
                sourceCount: options.sourceMetadata.meta.sourceCount,
                redirectCount: options.sourceMetadata.meta.redirectCount,
                disabledCount: options.sourceMetadata.meta.disabledCount,
                columnCount: options.sourceMetadata.meta.columnCount,
            },
            health: {
                updatedAt: options.healthSummary.updatedAt,
                total: options.healthSummary.total,
                healthy: options.healthSummary.healthy,
                failing: options.healthSummary.failing,
                idle: options.healthSummary.idle,
                cacheDegraded: options.healthSummary.cacheDegraded,
            },
        },
        meta: {
            generatedAt: options.generatedAt,
        },
        errors: [],
    };
}

function createEndpointMap(): NodeManifestEndpointMap {
    return {
        node: withApiPrefix(sourceApi.nodeV1),
        openApi: withApiPrefix(sourceApi.openApiV1),
        source: `${withApiPrefix(sourceApi.sourcesV1)}/{id}`,
        sources: withApiPrefix(sourceApi.sourcesV1),
        sourceItems: `${withApiPrefix(sourceApi.sourcesV1)}/{id}/items`,
        sourceBatch: withApiPrefix(sourceApi.sourceBatchV1),
        sourceHealth: withApiPrefix(sourceApi.sourceHealthV1),
        sourceHealthDiagnostics: withApiPrefix(sourceApi.sourceHealthDiagnosticsV1),
        deploymentHealth: withApiPrefix(sourceApi.deploymentHealthV1),
        jsonFeed: withApiPrefix(sourceApi.jsonFeedV1),
        rssFeed: withApiPrefix(sourceApi.rssFeedV1),
    };
}

function createConnectionConfig(options: Pick<CreateNodeManifestOptions, "upstreamEndpoint" | "downstreamEndpoint">) {
    const upstreamEndpoint = normalizeEndpoint(options.upstreamEndpoint);
    const downstreamEndpoint = normalizeEndpoint(options.downstreamEndpoint);

    return {
        ...(upstreamEndpoint && { upstreamEndpoint }),
        ...(downstreamEndpoint && { downstreamEndpoint }),
    };
}

function withApiPrefix(path: string) {
    return `${API_BASE_PATH}${path}`;
}

function normalizeEndpoint(value: string | undefined) {
    const endpoint = value?.trim();
    return endpoint || undefined;
}

function normalizeNodeId(value: string | undefined) {
    const nodeId = value?.trim();
    return nodeId || undefined;
}
