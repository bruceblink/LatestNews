import type { SourceID } from "@shared/types";

import process from "node:process";
import { logger } from "#/utils/logger";
import dataSources from "@shared/data-sources";
import { getCacheTable } from "#/database/cache";
import { createHash, timingSafeEqual } from "node:crypto";
import { isCancellationError } from "#/utils/source-engine";
import { hasSourceGetter, fetchSourceItems } from "#/utils/source-fetch";
import { getQuery, getHeader, setHeader, createError, defineEventHandler } from "h3";

const batchSize = 3;
const tokenPattern = /^[A-Za-z0-9_-]{32,128}$/;

/** Refresh one bounded page of the active catalog and confirm each cache write before reporting success. */
export default defineEventHandler(async (event) => {
    setHeader(event, "Cache-Control", "no-store");
    const cloudflare = event.req.runtime?.cloudflare;
    const secret = cloudflare ? cloudflare.env.LATESTNEWS_REFRESH_TOKEN : process.env.LATESTNEWS_REFRESH_TOKEN;
    if (typeof secret !== "string" || !tokenPattern.test(secret)) {
        throw createError({ statusCode: 503, message: "Source refresh is not configured." });
    }

    const token = /^Bearer\s+(\S+)$/i.exec(getHeader(event, "authorization") ?? "")?.[1];
    if (!token || !tokenPattern.test(token) || !timingSafeEqual(hashToken(token), hashToken(secret))) {
        setHeader(event, "WWW-Authenticate", "Bearer");
        throw createError({ statusCode: 401, message: "A valid source refresh token is required." });
    }

    const { cursor, force } = getQuery(event);
    if (cursor !== undefined && (typeof cursor !== "string" || !/^[A-Za-z0-9_.-]{1,120}$/.test(cursor))) {
        throw createError({ statusCode: 400, message: "Invalid source refresh cursor." });
    }
    if (force !== undefined && force !== "true" && force !== "false") {
        throw createError({ statusCode: 400, message: "Invalid source refresh force. Use true or false." });
    }

    const cache = await getCacheTable();
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
                const items = await fetchSourceItems(id, { signal });
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

function hashToken(value: string) {
    return createHash("sha256").update(value).digest();
}
