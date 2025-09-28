import type { Database } from "db0";
import type { NewsItem } from "@shared/types";

import process from "node:process";

import { logger } from "../utils/logger";

import type { CacheRow, CacheInfo } from "../types";

export class Cache {
    private db;
    constructor(db: Database) {
        this.db = db;
    }

    async init() {
        await this.db
            .prepare(
                `
                  CREATE TABLE IF NOT EXISTS cache (
                    id TEXT PRIMARY KEY,
                    updated INTEGER,
                    data TEXT
                  );
              `
            )
            .run();
        logger.success("init cache table");
    }

    async set(key: string, value: NewsItem[]) {
        const now = Date.now();
        await this.db
            .prepare(
                `INSERT INTO cache (id, data, updated) 
                        VALUES (?, ?, ?) 
                        ON CONFLICT (id) DO UPDATE SET 
                            data = EXCLUDED.data,
                            updated = EXCLUDED.updated;`
            )
            .run(key, JSON.stringify(value), now);
        logger.success(`set ${key} cache`);
    }

    async get(key: string): Promise<CacheInfo | undefined> {
        const row = (await this.db.prepare("SELECT id, data, updated FROM cache WHERE id = ?").get(key)) as
            | CacheRow
            | undefined;
        if (row) {
            logger.success(`get ${key} cache`);
            return {
                id: row.id,
                updated: row.updated,
                items: JSON.parse(row.data),
            };
        }
        return undefined;
    }

    async getEntire(keys: string[]): Promise<CacheInfo[]> {
        const keysStr = keys.map((k) => `id = '${k}'`).join(" or ");
        const res = (await this.db
            .prepare(
                `SELECT id, data, updated
                                         FROM cache
               WHERE ${keysStr}`
            )
            .all()) as any;
        const rows = (res.results ?? res) as CacheRow[];

        /**
         * https://developers.cloudflare.com/d1/build-with-d1/d1-client-api/#return-object
         * cloudflare d1 .all() will return
         * {
         *   success: boolean
         *   meta:
         *   results:
         * }
         */
        if (rows?.length) {
            logger.success("get entire (...) cache");
            return rows.map((row) => ({
                id: row.id,
                updated: row.updated,
                items: JSON.parse(row.data) as NewsItem[],
            }));
        } else {
            return [];
        }
    }

    async delete(key: string) {
        return await this.db.prepare("DELETE FROM cache WHERE id = ?").run(key);
    }
}

export async function getCacheTable() {
    try {
        // @ts-ignore
        // eslint-disable-next-line react-hooks/rules-of-hooks
        const db = useDatabase();
        if (process.env.ENABLE_CACHE === "false") return;
        const cacheTable = new Cache(db);
        if (process.env.INIT_TABLE !== "false") await cacheTable.init();
        // eslint-disable-next-line consistent-return
        return cacheTable;
    } catch (e) {
        logger.error("failed to init database ", e);
    }
}
