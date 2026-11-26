import { HOME_PAGE } from "@shared/consts";
import { createRssFeedXml } from "@shared/feed-export";
import { publicSourceHttpError } from "#/utils/public-source-error";
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
                message: "Invalid RSS feed query",
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
        const response = await resolveSourceBatchPayload(payload, {
            event,
            logPrefix: "rss feed",
            signal: event.req.signal,
            background: (pending) => event.waitUntil(pending),
        });
        setResponseHeader(event, "content-type", "application/rss+xml; charset=utf-8");
        return createRssFeedXml(response, {
            title: getFeedTitle(parsedQuery.data),
            description: getFeedDescription(parsedQuery.data),
            siteUrl: HOME_PAGE,
            feedUrl: url.toString(),
            generatedAt: response.meta.generatedAt,
            maxItems: getMaxFeedItems(parsedQuery.data),
        });
    } catch (error) {
        throw publicSourceHttpError(error);
    }
});
