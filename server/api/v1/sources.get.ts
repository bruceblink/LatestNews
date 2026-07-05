import type { SourceMetadataResponse } from "@shared/source-metadata";

import { logger } from "#/utils/logger";
import { createError, defineEventHandler } from "h3";
import { createSourceMetadataResponse } from "@shared/source-metadata";

export default defineEventHandler((): SourceMetadataResponse => {
    try {
        return createSourceMetadataResponse({
            generatedAt: Date.now(),
        });
    } catch (error) {
        logger.error(error);
        throw createError({
            statusCode: 500,
            message: error instanceof Error ? error.message : "Internal Server Error",
        });
    }
});
