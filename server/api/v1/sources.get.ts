import type { SourceMetadataResponse } from "@shared/source-metadata";

import { defineEventHandler } from "h3";
import { publicSourceHttpError } from "#/utils/public-source-error";
import { createSourceMetadataResponse } from "@shared/source-metadata";
import { initializeCrawlerPluginCatalog } from "#/utils/crawler-plugin-runtime";

export default defineEventHandler((): SourceMetadataResponse => {
    try {
        initializeCrawlerPluginCatalog();
        return createSourceMetadataResponse({
            generatedAt: Date.now(),
        });
    } catch (error) {
        throw publicSourceHttpError(error);
    }
});
