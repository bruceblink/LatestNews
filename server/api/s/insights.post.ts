import type { SourceID } from "@shared/types";
import type { NewsInsightsPayload, NewsInsightsResponse } from "@shared/source-api";

import { z } from "zod";
import { logger } from "#/utils/logger";
import { getCacheTable } from "#/database/cache";
import dataSources from "@shared/data-sources.ts";
import { readBody, createError, defineEventHandler } from "h3";
import { resolveNewsInsights } from "#/utils/resolve-news-insights";
import { hasSourceGetter, fetchSourceItems } from "#/utils/source-fetch";

const insightLimitSchema = z.number().int().min(1).max(100).optional();
const newsInsightsSchema = z.object({
    sources: z.array(z.string()).max(100),
    hotLimit: insightLimitSchema,
    topicLimit: insightLimitSchema,
    wordLimit: insightLimitSchema,
    minTopicItems: z.number().int().min(1).max(20).optional(),
    readUrls: z.array(z.string()).max(500).optional(),
});

export default defineEventHandler(async (event): Promise<NewsInsightsResponse> => {
    const parsedBody = newsInsightsSchema.safeParse(await readBody(event));
    if (!parsedBody.success) {
        throw createError({
            statusCode: 400,
            message: "Invalid insights payload",
        });
    }

    const cacheTable = await getCacheTable();
    const { ids, invalidIds } = normalizeSourceIds(parsedBody.data.sources);
    const caches = cacheTable ? await cacheTable.getEntire(ids) : [];

    return await resolveNewsInsights({
        sourceIds: ids,
        cacheEntries: caches,
        invalidSourceIds: invalidIds,
        fetchMissing: fetchSourceItems,
        saveCache: async (id, items) => {
            if (!cacheTable) return;
            await cacheTable.set(id, items);
        },
        now: Date.now(),
        insightOptions: createInsightOptions(parsedBody.data),
        onFetchError: (error, id) => logger.error(`fetch ${id} insights failed`, error),
    });
});

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

function createInsightOptions(payload: Omit<NewsInsightsPayload, "sources">) {
    return {
        hotLimit: payload.hotLimit,
        topicLimit: payload.topicLimit,
        wordLimit: payload.wordLimit,
        minTopicItems: payload.minTopicItems,
        readUrls: payload.readUrls,
    };
}
