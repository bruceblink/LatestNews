import type { SourceID } from "@shared/types";
import type { SourceMetadataItemResponse } from "@shared/source-metadata";

import { logger } from "#/utils/logger";
import { createError, getRouterParam, defineEventHandler } from "h3";
import { createSourceMetadataItemResponse } from "@shared/source-metadata";

export default defineEventHandler((event): SourceMetadataItemResponse => {
    try {
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
        logger.error(error);
        if (error && typeof error === "object" && "statusCode" in error) throw error;
        throw createError({
            statusCode: 500,
            message: error instanceof Error ? error.message : "Internal Server Error",
        });
    }
});
