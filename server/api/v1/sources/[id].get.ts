import type { SourceID } from "@shared/types";
import type { SourceMetadataItemResponse } from "@shared/source-metadata";

import { publicSourceHttpError } from "#/utils/public-source-error";
import { createError, getRouterParam, defineEventHandler } from "h3";
import { createSourceMetadataItemResponse } from "@shared/source-metadata";
import { initializeCrawlerPluginCatalog } from "#/utils/crawler-plugin-runtime";

export default defineEventHandler((event): SourceMetadataItemResponse => {
    try {
        initializeCrawlerPluginCatalog();
        const sourceId = getRouterParam(event, "id");
        if (!sourceId) {
            throw createError({
                statusCode: 400,
                message: "Invalid source id",
            });
        }

        const response = createSourceMetadataItemResponse({
            sourceId: sourceId as SourceID,
            generatedAt: Date.now(),
        });

        if (!response) {
            throw createError({
                statusCode: 400,
                message: "Invalid source id",
            });
        }

        return response;
    } catch (error) {
        throw publicSourceHttpError(error);
    }
});
