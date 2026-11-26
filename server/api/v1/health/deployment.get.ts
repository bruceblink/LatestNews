import type { DeploymentHealthResponse } from "@shared/deployment-health";

import process from "node:process";
import { defineEventHandler } from "h3";
import { getCacheTable } from "#/database/cache";
import { Version, APP_NAME } from "@shared/consts";
import { getSourceHealthSummary } from "#/utils/source-health";
import { publicSourceHttpError } from "#/utils/public-source-error";
import { getDeploymentCacheStatus, createDeploymentHealthResponse } from "@shared/deployment-health";

export default defineEventHandler(async (event): Promise<DeploymentHealthResponse> => {
    try {
        const cacheDisabled = (event.req.runtime?.cloudflare?.env.ENABLE_CACHE ?? process.env.ENABLE_CACHE) === "false";
        const cacheTable = cacheDisabled ? undefined : await getCacheTable(event);

        return createDeploymentHealthResponse({
            appName: APP_NAME,
            appVersion: Version,
            cacheStatus: getDeploymentCacheStatus({
                cacheAvailable: Boolean(cacheTable),
                cacheDisabled,
            }),
            generatedAt: Date.now(),
            sourceSummary: getSourceHealthSummary(),
            articleIndex: cacheTable
                ? await cacheTable.getArticleIndexHealth()
                : {
                      status: cacheDisabled ? "disabled" : "unavailable",
                      fts: cacheDisabled ? "disabled" : "unavailable",
                      pendingIngest: null,
                      pendingFts: null,
                      eventRegistry: cacheDisabled ? "disabled" : "unknown",
                  },
        });
    } catch (error) {
        throw publicSourceHttpError(error);
    }
});
