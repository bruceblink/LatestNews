import type { NodeManifestResponse } from "@shared/node-manifest";

import process from "node:process";
import { logger } from "#/utils/logger";
import { createError, defineEventHandler } from "h3";
import { Version, APP_NAME, HOME_PAGE } from "@shared/consts";
import { getSourceHealthSummary } from "#/utils/source-health";
import { createNodeManifestResponse } from "@shared/node-manifest";
import { createSourceMetadataResponse } from "@shared/source-metadata";

export default defineEventHandler((): NodeManifestResponse => {
    try {
        const generatedAt = Date.now();

        return createNodeManifestResponse({
            appName: APP_NAME,
            appVersion: Version,
            downstreamEndpoint: process.env.LATESTNEWS_DOWNSTREAM_ENDPOINT,
            generatedAt,
            healthSummary: getSourceHealthSummary(),
            homepage: HOME_PAGE,
            nodeId: process.env.LATESTNEWS_NODE_ID,
            sourceMetadata: createSourceMetadataResponse({
                generatedAt,
            }),
            upstreamEndpoint: process.env.LATESTNEWS_UPSTREAM_ENDPOINT,
        });
    } catch (error) {
        logger.error(error);
        throw createError({
            statusCode: 500,
            message: error instanceof Error ? error.message : "Internal Server Error",
        });
    }
});
