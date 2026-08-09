import process from "node:process";
import { Version, APP_NAME, HOME_PAGE } from "@shared/consts";
import { getSourceHealthSummary } from "#/utils/source-health";
import { createNodeManifestResponse } from "@shared/node-manifest";
import { createSourceMetadataResponse } from "@shared/source-metadata";
import { parseFederationDownstreamConfig } from "@shared/federation-downstream";

/** Builds the local node manifest shared by the public discovery route and authenticated federation reads. */
export function createLocalNodeManifestResponse(generatedAt = Date.now()) {
    const downstreamConfig = parseFederationDownstreamConfig(process.env.LATESTNEWS_FEDERATION_DOWNSTREAM_KEYS);
    return createNodeManifestResponse({
        appName: APP_NAME,
        appVersion: Version,
        downstreamEndpoint: process.env.LATESTNEWS_DOWNSTREAM_ENDPOINT,
        ...(downstreamConfig.valid &&
            downstreamConfig.keys.length && {
                federation: {
                    protocolVersion: "1.0",
                    capabilities: ["downstream-node-manifest"],
                    authentication: { downstream: "bearer" as const },
                },
            }),
        generatedAt,
        healthSummary: getSourceHealthSummary(),
        homepage: HOME_PAGE,
        nodeId: process.env.LATESTNEWS_NODE_ID,
        sourceMetadata: createSourceMetadataResponse({ generatedAt }),
        upstreamEndpoint: process.env.LATESTNEWS_UPSTREAM_ENDPOINT,
    });
}
