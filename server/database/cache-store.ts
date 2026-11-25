import type { Database } from "db0";
import type { NewsItem, SourceID } from "@shared/types";
import type { TopicEvent } from "@shared/news-insights";

import { randomUUID } from "node:crypto";
import { filterSafeNewsItemLinks } from "@shared/news-url-policy";

import { logger } from "../utils/logger";
import { ArticleIndex } from "./article-index";
import { executeArticleBatch } from "./article-atomic-batch";

import type { CacheRow, CacheInfo } from "../types";
import type { ArticleEventQuery, ArticleIndexSearchQuery, ArticleIndexSearchResult } from "./article-index";

export class Cache {
    private db: Database;
    private articleIndex?: ArticleIndex;
    private recoveryAvailable = false;
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
            this.recoveryAvailable = await this.articleIndex.probe();
            if (this.recoveryAvailable) await this.maintainArticleIndex(5);
        } catch (error) {
            this.articleIndex = undefined;
            logger.warn("Could not initialize article index. Source cache remains available.", error);
        }
        logger.success("init cache table");
    }

    async check() {
        await this.db.prepare("SELECT id FROM cache LIMIT 1").get();
        this.articleIndex = new ArticleIndex(this.db);
        this.recoveryAvailable = await this.articleIndex.probe();
    }

    async set(key: string, value: NewsItem[]) {
        const safeItems = filterSafeNewsItemLinks(value);
        if (value.length && !safeItems.length) throw new Error("News cache contains no valid article URLs.");
        const now = Date.now();
        const payload = JSON.stringify(safeItems);
        const cacheSql = `INSERT INTO cache (id,data,updated) VALUES (?,?,?)
            ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated=max(cache.updated+1,excluded.updated)`;
        if (this.recoveryAvailable && this.articleIndex) {
            const id = randomUUID();
            try {
                await executeArticleBatch(this.db, [
                    { sql: cacheSql, params: [key, payload, now] },
                    {
                        sql: "INSERT INTO article_ingest_pending(id,source_id,payload,observed_at) SELECT ?,id,data,updated FROM cache WHERE id=?",
                        params: [id, key],
                    },
                ]);
            } catch (error) {
                // The cache must remain available if its indexing journal is unavailable.
                // A checkpoint comparison will rediscover the latest snapshot when repaired.
                logger.warn("Could not journal source cache; retaining cache-only write.", error);
                const result = await this.db.prepare(cacheSql).run(key, payload, now);
                if (!result.success) throw new Error("News cache write failed.");
            }
            // A committed cache write is not a promise of completed indexing.
            await this.maintainArticleIndex(2, id);
        } else {
            const result = await this.db.prepare(cacheSql).run(key, payload, now);
            if (!result.success) throw new Error("News cache write failed.");
            // Do not write an unprobed or pre-migration index.
            logger.warn("Article recovery schema unavailable; saved source cache only.");
        }
        logger.success(`set ${key} cache`);
    }

    /** Bounded journal replay. Persist each source snapshot until all articles succeed. */
    async maintainArticleIndex(limit = 5, preferredId = "") {
        if (!this.articleIndex || !this.recoveryAvailable) return;
        if (!Number.isInteger(limit) || limit < 1 || limit > 20)
            throw new Error("Article replay limit must be between 1 and 20.");
        try {
            // Recover pre-journal snapshots or a cache-only fallback without duplicating work.
            await this.db
                .prepare(
                    `INSERT INTO article_ingest_pending(id,source_id,payload,observed_at)
                SELECT lower(hex(randomblob(16))),c.id,c.data,c.updated FROM cache c
                WHERE NOT EXISTS(SELECT 1 FROM article_ingest_checkpoint p WHERE p.source_id=c.id AND p.observed_at=c.updated AND p.payload=c.data)
                AND NOT EXISTS(SELECT 1 FROM article_ingest_pending p WHERE p.source_id=c.id AND p.observed_at=c.updated AND p.payload=c.data)
                ORDER BY c.updated,c.id LIMIT ?`
                )
                .run(limit);
            const pending = (await this.db
                .prepare(
                    "SELECT id,source_id,payload,observed_at FROM article_ingest_pending ORDER BY CASE WHEN id=? THEN 0 ELSE 1 END, attempts, observed_at,id LIMIT ?"
                )
                .all(preferredId, limit)) as Array<{
                id: string;
                source_id: string;
                payload: string;
                observed_at: number;
            }>;
            for (const row of pending) {
                try {
                    const items = JSON.parse(row.payload) as NewsItem[];
                    if (!Array.isArray(items)) throw new Error("Invalid cached article snapshot.");
                    await this.articleIndex.upsertSourceItems(row.source_id as SourceID, items, row.observed_at);
                    await executeArticleBatch(this.db, [
                        {
                            sql: `INSERT INTO article_ingest_checkpoint(source_id,payload,observed_at)
                            SELECT id,data,updated FROM cache WHERE id=? AND data=? AND updated=?
                            ON CONFLICT(source_id) DO UPDATE SET payload=excluded.payload,observed_at=excluded.observed_at`,
                            params: [row.source_id, row.payload, row.observed_at],
                        },
                        { sql: "DELETE FROM article_ingest_pending WHERE id=?", params: [row.id] },
                    ]);
                } catch (error) {
                    logger.warn("Could not replay article snapshot; journal retained.", error);
                    await this.db
                        .prepare("UPDATE article_ingest_pending SET attempts=attempts+1 WHERE id=?")
                        .run(row.id);
                }
            }
            await this.articleIndex.continueRepair(2);
        } catch (error) {
            logger.warn("Article maintenance is unavailable; source cache remains available.", error);
        }
    }

    async getArticleIndexHealth() {
        const index = this.articleIndex ?? new ArticleIndex(this.db);
        const status = await index.getRecoveryStatus();
        if (status.status === "unavailable") return status;
        try {
            const row = (await this.db
                .prepare(
                    `SELECT COUNT(*) AS count FROM cache c
                WHERE NOT EXISTS(SELECT 1 FROM article_ingest_checkpoint p WHERE p.source_id=c.id AND p.observed_at=c.updated AND p.payload=c.data)
                AND NOT EXISTS(SELECT 1 FROM article_ingest_pending p WHERE p.source_id=c.id AND p.observed_at=c.updated AND p.payload=c.data)`
                )
                .get()) as { count: number };
            return {
                ...status,
                status: Number(row.count) > 0 ? ("degraded" as const) : status.status,
                untrackedCache: Number(row.count),
            };
        } catch {
            return { ...status, status: "degraded" as const, untrackedCache: null };
        }
    }

    async resolveArticleEventIds(topicEvents: TopicEvent[]) {
        // Existing tables remain usable when INIT_TABLE is disabled.
        return (this.articleIndex ?? new ArticleIndex(this.db)).resolveEventIds(topicEvents);
    }

    async getArticleEvent(eventId: string, query: ArticleEventQuery) {
        return (this.articleIndex ?? new ArticleIndex(this.db)).getEvent(eventId, query);
    }

    async searchArticles(query: ArticleIndexSearchQuery): Promise<ArticleIndexSearchResult> {
        if (this.articleIndex) return this.articleIndex.search(query);
        return new ArticleIndex(this.db).searchLike(query);
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
                items: filterSafeNewsItemLinks(JSON.parse(row.data) as NewsItem[]),
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
                items: filterSafeNewsItemLinks(JSON.parse(row.data) as NewsItem[]),
            }));
        } else {
            return [];
        }
    }

    async delete(key: string) {
        return await this.db.prepare("DELETE FROM cache WHERE id = ?").run(key);
    }
}
