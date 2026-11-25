import type { H3Event } from "h3";

import process from "node:process";
import { useDatabase as getDatabase } from "nitro/database";

import { Cache } from "./cache-store";
import { logger } from "../utils/logger";
import { createRequestD1Database } from "./request-d1";

export { Cache } from "./cache-store";

let cacheTablePromise: Promise<Cache | undefined> | undefined;

export async function getCacheTable(event?: H3Event) {
    const cloudflare = event?.req.runtime?.cloudflare;
    if (cloudflare) {
        // A promise or binding created in request A must never gate request B.
        if ((cloudflare.env.ENABLE_CACHE ?? process.env.ENABLE_CACHE) === "false") return undefined;
        try {
            const cache = new Cache(createRequestD1Database(cloudflare.env.LATESTNEWS_DB), {
                deferMaintenance: (pending) => event!.waitUntil(pending),
            });
            await cache.openPages((cloudflare.env.INIT_TABLE ?? process.env.INIT_TABLE) !== "false");
            return cache;
        } catch (error) {
            logger.error("failed to open request D1 cache", error);
            return undefined;
        }
    }

    cacheTablePromise ??= (async () => {
        try {
            if (process.env.ENABLE_CACHE === "false") return undefined;

            const initialized = new Cache(getDatabase());
            if (process.env.INIT_TABLE !== "false") await initialized.init();
            else await initialized.check();
            return initialized;
        } catch (error) {
            cacheTablePromise = undefined;
            logger.error("failed to init database ", error);
            return undefined;
        }
    })();

    return cacheTablePromise;
}
