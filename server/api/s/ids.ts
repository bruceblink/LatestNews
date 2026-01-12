import type { SourceID } from "@shared/types.ts";

import { logger } from "#/utils/logger.ts";
import dataSources from "@shared/data-sources.ts";
import { createError, defineEventHandler } from "h3";

export default defineEventHandler(async () => {
    try {
        // 剔除重复的id(即包含redirect属性的id)
        return Object.entries(dataSources)
            .filter(([_, v]) => !v.redirect)
            .map(([k]) => k as SourceID);
    } catch (e: any) {
        logger.error(e);
        throw createError({
            statusCode: 500,
            message: e instanceof Error ? e.message : "Internal Server Error",
        });
    }
});
