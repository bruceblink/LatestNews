import type { DeploymentHealthResponse } from "@shared/deployment-health";

import process from "node:process";
import { logger } from "#/utils/logger";
import { getCacheTable } from "#/database/cache";
import { Version, APP_NAME } from "@shared/consts";
import { createError, defineEventHandler } from "h3";
import { getSourceHealthSummary } from "#/utils/source-health";
import { getDeploymentCacheStatus, createDeploymentHealthResponse } from "@shared/deployment-health";

export default defineEventHandler(async (): Promise<DeploymentHealthResponse> => {
    try {
        const cacheDisabled = process.env.ENABLE_CACHE === "false";
        const cacheTable = cacheDisabled ? undefined : await getCacheTable();

        return createDeploymentHealthResponse({
            appName: APP_NAME,
            appVersion: Version,
            cacheStatus: getDeploymentCacheStatus({
                cacheAvailable: Boolean(cacheTable),
                cacheDisabled,
            }),
            generatedAt: Date.now(),
            sourceSummary: getSourceHealthSummary(),
        });
    } catch (error) {
        logger.error(error);
        throw createError({
            statusCode: 500,
            message: error instanceof Error ? error.message : "Internal Server Error",
        });
    }
});
