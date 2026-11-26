import type { NodeManifestResponse } from "@shared/node-manifest";

import { defineEventHandler } from "h3";
import { publicSourceHttpError } from "#/utils/public-source-error";
import { createLocalNodeManifestResponse } from "#/utils/local-node-manifest";
import { initializeCrawlerPluginCatalog } from "#/utils/crawler-plugin-runtime";

export default defineEventHandler((): NodeManifestResponse => {
    try {
        initializeCrawlerPluginCatalog();
        const generatedAt = Date.now();

        return createLocalNodeManifestResponse(generatedAt);
    } catch (error) {
        throw publicSourceHttpError(error);
    }
});
