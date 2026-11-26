import { getCacheTable } from "#/database/cache";
import { requireRefreshToken } from "#/utils/refresh-token";
import { getQuery, createError, setResponseStatus, defineEventHandler } from "h3";

/** Deployment-owned scheduling only. Never collects sources or accepts article payloads. */
export default defineEventHandler(async (event) => {
    requireRefreshToken(event);
    const raw = getQuery(event).limit;
    if (raw !== undefined && (typeof raw !== "string" || !/^(?:[1-9]|1[0-9]|20)$/.test(raw)))
        throw createError({ statusCode: 400, message: "Maintenance limit must be between 1 and 20." });
    const cache = await getCacheTable(event);
    if (!cache) throw createError({ statusCode: 503, message: "Article maintenance requires a writable cache." });
    const result = await cache.runArticleMaintenance(raw === undefined ? 5 : Number(raw), event.req.signal);
    if (result.status === "busy") setResponseStatus(event, 409);
    if (result.status === "unavailable" || result.status === "interrupted") setResponseStatus(event, 503);
    return { data: result, meta: { generatedAt: Date.now() }, errors: [] };
});
