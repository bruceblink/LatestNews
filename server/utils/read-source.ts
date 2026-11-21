import type { H3Event } from "h3";
import type { SourceID } from "@shared/types";

import { TTL } from "@shared/consts";
import dataSources from "@shared/data-sources";
import { getCacheTable } from "#/database/cache";
import { shouldDegradeSourceToCache } from "@shared/source-health-policy";

import { logger } from "./logger";
import { fetchSourceItems } from "./source-fetch";
import { getSourceHealthSnapshot } from "./source-health";
import { resolveSourceResponse } from "./resolve-source-response";

/** Read available news and apply the caller's refresh permissions and cache policy. */
export async function readSource(id: SourceID, latest: boolean, clearCache: boolean, event: H3Event) {
    const cacheTable = await getCacheTable();
    const cache = await cacheTable?.get(id).catch((error: unknown) => {
        logger.warn(`Could not read source cache for ${id}.`, error);
        return undefined;
    });
    const health = getSourceHealthSnapshot(id);
    const canRefresh = Boolean(event.context.disabledLogin || event.context.user);

    return resolveSourceResponse({
        id,
        cache,
        latest,
        canRefresh,
        name: dataSources[id].name,
        degraded: shouldDegradeSourceToCache(health),
        clearCache: clearCache && canRefresh,
        sourceInterval: dataSources[id].interval ?? TTL,
        now: Date.now(),
        lastAttemptAt: health.status === "failing" ? health.lastErrorAt : health.lastSuccessAt,
        fetchLatest: () => fetchSourceItems(id),
        saveCache: cacheTable ? (items) => cacheTable.set(id, items) : undefined,
        background: (pending) => event.waitUntil(pending),
        onFetchError: (error) => logger.warn(`Source update for ${id} failed.`, error),
    });
}
