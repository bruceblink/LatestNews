import type { NodeManifestResponse } from "@shared/node-manifest";

import { logger } from "#/utils/logger";
import { createError, defineEventHandler } from "h3";
import { createLocalNodeManifestResponse } from "#/utils/local-node-manifest";
import { initializeCrawlerPluginCatalog } from "#/utils/crawler-plugin-runtime";

export default defineEventHandler((): NodeManifestResponse => {
    try {
        initializeCrawlerPluginCatalog();
        const generatedAt = Date.now();

        return createLocalNodeManifestResponse(generatedAt);
    } catch (error) {
        logger.error(error);
        throw createError({
            statusCode: 500,
            message: error instanceof Error ? error.message : "Internal Server Error",
        });
    }
});
