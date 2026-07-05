import { logger } from "#/utils/logger";
import { HOME_PAGE } from "@shared/consts";
import { createJsonFeed } from "@shared/feed-export";
import { getQuery, createError, getRequestURL, setResponseHeader, defineEventHandler } from "h3";

import { resolveSourceBatchPayload } from "../../../utils/resolve-source-batch";
import {
    getFeedTitle,
    getMaxFeedItems,
    getFeedDescription,
    sourceFeedQuerySchema,
    hasSourceFeedSelector,
    createSourceFeedPayload,
} from "../../../utils/source-feed-query";

export default defineEventHandler(async (event) => {
    try {
        const parsedQuery = sourceFeedQuerySchema.safeParse(getQuery(event));
        if (!parsedQuery.success) {
            throw createError({
                statusCode: 400,
                message: "Invalid JSON feed query",
            });
        }

        const payload = createSourceFeedPayload(parsedQuery.data);
        if (!hasSourceFeedSelector(payload)) {
            throw createError({
                statusCode: 400,
                message: "At least one source selector is required",
            });
        }

        const url = getRequestURL(event);
        const response = await resolveSourceBatchPayload(payload, { logPrefix: "json feed" });
        setResponseHeader(event, "content-type", "application/feed+json; charset=utf-8");
        return createJsonFeed(response, {
            title: getFeedTitle(parsedQuery.data),
            description: getFeedDescription(parsedQuery.data),
            siteUrl: HOME_PAGE,
            feedUrl: url.toString(),
            generatedAt: response.meta.generatedAt,
            maxItems: getMaxFeedItems(parsedQuery.data),
        });
    } catch (error) {
        if (error && typeof error === "object" && "statusCode" in error) throw error;
        logger.error(error);
        throw createError({
            statusCode: 500,
            message: error instanceof Error ? error.message : "Internal Server Error",
        });
    }
});
