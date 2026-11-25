import process from "node:process";
import { useDatabase as getDatabase } from "nitro/database";

import { Cache } from "./cache-store";
import { logger } from "../utils/logger";

export { Cache } from "./cache-store";

let cacheTablePromise: Promise<Cache | undefined> | undefined;

export async function getCacheTable() {
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
