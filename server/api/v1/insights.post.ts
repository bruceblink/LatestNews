import type { H3Event } from "h3";
import type { SourceID } from "@shared/types";
import type { NewsInsightsResponse } from "@shared/source-api";

import { z } from "zod";
import { logger } from "#/utils/logger";
import { getCacheTable } from "#/database/cache";
import dataSources from "@shared/data-sources.ts";
import { describeSourceError } from "@shared/source-error";
import { readBody, createError, defineEventHandler } from "h3";
import { publicSourceHttpError } from "#/utils/public-source-error";
import { resolveNewsInsights } from "#/utils/resolve-news-insights";
import { hasSourceGetter, fetchSourceItems } from "#/utils/source-fetch";
import { provisionalTopicEvent } from "#/database/article-event-governance";

const insightLimitSchema = z.number().int().min(1).max(100).optional();
const newsInsightsSchema = z.object({
    sources: z.array(z.string()).max(100),
    hotLimit: insightLimitSchema,
    topicLimit: insightLimitSchema,
    wordLimit: insightLimitSchema,
    trendLimit: insightLimitSchema,
    trendWindow: z.enum(["24h", "7d"]).optional(),
    minTopicItems: z.number().int().min(1).max(20).optional(),
    readUrls: z.array(z.string()).max(500).optional(),
    hiddenUrls: z.array(z.string()).max(500).optional(),
});

export default defineEventHandler(async (event): Promise<NewsInsightsResponse> => {
    try {
        return await readInsights(event);
    } catch (error) {
        throw publicSourceHttpError(error);
    }
});

async function readInsights(event: H3Event): Promise<NewsInsightsResponse> {
    const parsedBody = newsInsightsSchema.safeParse(await readBody(event));
    if (!parsedBody.success) {
        throw createError({
            statusCode: 400,
            message: "Invalid insights payload",
        });
    }

    const cacheTable = await getCacheTable(event);
    const { ids, invalidIds } = normalizeSourceIds(parsedBody.data.sources);
    const caches =
        (await cacheTable?.getEntire(ids).catch((error: unknown) => {
            logger.warn("Could not read insights cache.", describeSourceError(error));
            return [];
        })) ?? [];

    const response = await resolveNewsInsights({
        sourceIds: ids,
        cacheEntries: caches,
        invalidSourceIds: invalidIds,
        signal: event.req.signal,
        fetchMissing: (id, signal) => fetchSourceItems(id, { signal }),
        saveCache: async (id, items) => {
            if (!cacheTable) return;
            await cacheTable.set(id, items);
        },
        now: Date.now(),
        insightOptions: parsedBody.data,
        // D1 写入必须在当前请求内完成。Cloudflare Pages 不允许把绑定请求产生的
        // Promise 延迟到响应结束后继续结算，否则会触发跨请求 Promise 异常。
        onFetchError: (error, id) => logger.error(`fetch ${id} insights failed`, describeSourceError(error)),
        onCacheError: (error, id) => logger.warn(`Could not save ${id} insights cache.`, describeSourceError(error)),
    });

    response.data.topicEvents = cacheTable
        ? await cacheTable.resolveArticleEventIds(response.data.topicEvents)
        : response.data.topicEvents.map((topic) => provisionalTopicEvent(topic, "unavailable"));

    if (event.req.runtime?.cloudflare && cacheTable) {
        // Cached-only visits can still advance historical recovery without
        // keeping the dashboard waiting for index writes.
        event.waitUntil(cacheTable.schedulePagesBacklogIfNeeded());
    }
    return response;
}

function normalizeSourceIds(sources: string[]) {
    const ids: SourceID[] = [];
    const invalidIds: string[] = [];
    const seen = new Set<string>();

    for (const key of sources) {
        if (seen.has(key)) continue;
        seen.add(key);

        const id = key as SourceID;
        if (dataSources[id] && hasSourceGetter(id)) ids.push(id);
        else invalidIds.push(key);
    }

    return { ids, invalidIds };
}
