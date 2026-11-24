import type { Database } from "db0";
import type { NewsItem, SourceID } from "@shared/types";
import type { TopicEvent } from "@shared/news-insights";

import process from "node:process";
import { useDatabase as getDatabase } from "nitro/database";

import { logger } from "../utils/logger";
import { ArticleIndex } from "./article-index";

import type { CacheRow, CacheInfo } from "../types";
import type { ArticleIndexSearchQuery, ArticleIndexSearchResult } from "./article-index";

export class Cache {
    private db: Database;
    private articleIndex?: ArticleIndex;
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
        try {
            this.articleIndex = new ArticleIndex(this.db);
            await this.articleIndex.init();
        } catch (error) {
            this.articleIndex = undefined;
            logger.warn("Could not initialize article index. Source cache remains available.", error);
        }
        logger.success("init cache table");
    }

    async check() {
        await this.db.prepare("SELECT id FROM cache LIMIT 1").get();
    }

    async set(key: string, value: NewsItem[]) {
        const now = Date.now();
        const result = await this.db
            .prepare(
                `INSERT INTO cache (id, data, updated) 
                        VALUES (?, ?, ?) 
                        ON CONFLICT (id) DO UPDATE SET 
                            data = EXCLUDED.data,
                            updated = EXCLUDED.updated;`
            )
            .run(key, JSON.stringify(value), now);
        if (!result.success) throw new Error("News cache write failed.");
        try {
            await this.articleIndex?.upsertSourceItems(key as SourceID, value);
        } catch (error) {
            logger.warn(`Could not update article index for ${key}.`, error);
        }
        logger.success(`set ${key} cache`);
    }

    async updateArticleEventIds(topicEvents: TopicEvent[]) {
        try {
            return (await this.articleIndex?.updateEventIds(topicEvents)) ?? 0;
        } catch (error) {
            logger.warn("Could not update article event IDs.", error);
            return 0;
        }
    }

    async searchArticles(query: ArticleIndexSearchQuery): Promise<ArticleIndexSearchResult> {
        if (!this.articleIndex) return { status: "unavailable", mode: "unavailable", items: [] };
        return this.articleIndex.search(query);
    }

    async rebuildArticleSearchIndex() {
        if (!this.articleIndex) return { status: "unavailable" as const, indexed: 0 };
        return this.articleIndex.rebuildSearchIndex();
    }

    async get(key: string): Promise<CacheInfo | undefined> {
        const row = (await this.db.prepare("SELECT id, data, updated FROM cache WHERE id = ?").get(key)) as
            CacheRow | undefined;
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
        if (!keys.length) return [];

        const placeholders = keys.map(() => "?").join(", ");
        const res = (await this.db
            .prepare(
                `SELECT id, data, updated
                    FROM cache
                    WHERE id IN (${placeholders})`
            )
            .all(...keys)) as any;
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

let cacheTablePromise: Promise<Cache | undefined> | undefined;

export async function getCacheTable() {
    cacheTablePromise ??= (async () => {
        try {
            if (process.env.ENABLE_CACHE === "false") return undefined;

            const initialized = new Cache(getDatabase());
            if (process.env.INIT_TABLE === "true") await initialized.init();
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
