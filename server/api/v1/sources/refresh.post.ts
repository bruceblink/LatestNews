import type { SourceID } from "@shared/types";

import { logger } from "#/utils/logger";
import dataSources from "@shared/data-sources";
import { getCacheTable } from "#/database/cache";
import { requireRefreshToken } from "#/utils/refresh-token";
import { isCancellationError } from "#/utils/source-engine";
import { getQuery, createError, defineEventHandler } from "h3";
import { hasSourceGetter, fetchSourceItems } from "#/utils/source-fetch";

const batchSize = 3;

/** Refresh one bounded page of the active catalog and confirm each cache write before reporting success. */
export default defineEventHandler(async (event) => {
    requireRefreshToken(event);

    const { cursor, force } = getQuery(event);
    if (cursor !== undefined && (typeof cursor !== "string" || !/^[A-Za-z0-9_.-]{1,120}$/.test(cursor))) {
        throw createError({ statusCode: 400, message: "Invalid source refresh cursor." });
    }
    if (force !== undefined && force !== "true" && force !== "false") {
        throw createError({ statusCode: 400, message: "Invalid source refresh force. Use true or false." });
    }

    const cache = await getCacheTable(event);
    if (!cache) throw createError({ statusCode: 503, message: "Source refresh requires a writable news cache." });

    const ids = (Object.keys(dataSources) as SourceID[])
        .filter((id) => !dataSources[id].redirect && !dataSources[id].disable && hasSourceGetter(id))
        .sort();
    const remaining = ids.filter((id) => cursor === undefined || id > cursor);
    const sourceIds = remaining.slice(0, batchSize);
    const now = Date.now();
    const cacheEntries = force === "true" ? [] : await cache.getEntire(sourceIds);
    const cached = new Map(cacheEntries.map((entry) => [entry.id, entry.updated]));
    const signal = event.req.signal;
    const results = await Promise.allSettled(
        sourceIds.map(async (id) => {
            const updatedAt = cached.get(id);
            if (updatedAt !== undefined && now - updatedAt < dataSources[id].interval) {
                return { id, status: "fresh" as const };
            }

            try {
                const items = await fetchSourceItems(id, { signal, event });
                signal.throwIfAborted();
                if (!items.length) return { id, status: "empty" as const };
                await cache.set(id, items);
                return { id, status: "refreshed" as const, itemCount: items.length };
            } catch (error) {
                if (signal.aborted || isCancellationError(error)) {
                    throw createError({ statusCode: 503, message: "Source refresh was interrupted. Retry this page." });
                }
                logger.warn(`Source refresh could not update ${id}.`);
                return { id, status: "failed" as const };
            }
        })
    );

    const sources = results.map((result) => {
        if (result.status === "rejected") throw result.reason;
        return result.value;
    });
    cache.schedulePagesMaintenance();
    logger.info(`Source refresh processed ${sources.length} of ${ids.length} eligible sources.`);
    return {
        data: { sources },
        meta: {
            generatedAt: now,
            totalSources: ids.length,
            nextCursor: remaining.length > batchSize ? sourceIds.at(-1)! : null,
        },
        errors: sources
            .filter(({ status }) => status === "failed")
            .map(({ id }) => ({ sourceId: id, message: "Source collection or cache write failed." })),
    };
});
