import type { Database } from "db0";
import type { NewsItem, SourceID } from "@shared/types";
import type { TopicEvent } from "@shared/news-insights";

import { randomUUID } from "node:crypto";
import { describeSourceError } from "@shared/source-error";
import { filterSafeNewsItemLinks } from "@shared/news-url-policy";

import { logger } from "../utils/logger";
import { ArticleIndex } from "./article-index";
import { executeArticleBatch } from "./article-atomic-batch";
import { ftsRecoveryStatus, initArticleFtsAudit } from "./article-recovery";
import { recordTrace, monotonicNow, getBenchmarkTrace, measureBenchmarkPhase } from "../utils/collection-trace";
import {
    leaseGuard,
    retryDelay,
    maintenanceTables,
    SNAPSHOT_CHUNK_SIZE,
    ownsMaintenanceLease,
    hasArticleMaintenance,
    MAINTENANCE_BUDGET_MS,
    initArticleMaintenance,
    readMaintenanceBacklog,
    acquireMaintenanceLease,
    releaseMaintenanceLease,
} from "./article-maintenance";

import type { CacheRow, CacheInfo } from "../types";
import type { MaintenanceResult } from "./article-maintenance";
import type { ArticleEventQuery, ArticleIndexSearchQuery, ArticleIndexSearchResult } from "./article-index";

export class Cache {
    private db: Database;
    private articleIndex?: ArticleIndex;
    private recoveryAvailable = false;
    private maintenanceAvailable = false;
    private replayTail: Promise<void> = Promise.resolve();
    private readonly activeWrites = new Map<string, { payload: string; promise: Promise<void> }>();
    private maintenanceScheduled = false;
    constructor(
        db: Database,
        private readonly options: { deferMaintenance?: (pending: Promise<unknown>) => void } = {}
    ) {
        this.db = db;
    }

    /** Pages reads must not await journal replay, repair, or legacy table scans. */
    async openPages(autoInit: boolean) {
        const tables = (await this.db
            .prepare(
                "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('cache','articles','news_events','news_event_aliases','news_event_approvals','article_search','article_fts_audit','article_maintenance_lease','article_ingest_work')"
            )
            .all()) as Array<{ name: string }>;
        const names = new Set(tables.map((row) => row.name));
        if (!names.has("cache")) {
            if (!autoInit) throw new Error("Source cache schema is unavailable.");
            await this.createCacheTable();
        }
        const index = new ArticleIndex(this.db);
        this.articleIndex = index;
        this.recoveryAvailable = await index.probe(false);
        // Only a fresh database or an already migrated index can receive the
        // additive schema setup in an interactive request. Older data migration
        // is an explicit maintenance operation, not part of cache availability.
        if (
            autoInit &&
            (!names.has("articles") ||
                (this.recoveryAvailable &&
                    ["news_events", "news_event_aliases", "news_event_approvals", "article_search"].some(
                        (name) => !names.has(name)
                    )))
        ) {
            try {
                await index.init(false);
                this.recoveryAvailable = await index.probe(false);
            } catch (error) {
                this.recoveryAvailable = false;
                logger.warn(
                    "Could not initialize Pages article schema; source cache remains available.",
                    describeSourceError(error)
                );
            }
        } else if (autoInit && this.recoveryAvailable && !names.has("article_fts_audit")) {
            // Additive migration only; do not re-run article schema migration
            // or perform a full FTS audit in an interactive Pages read.
            try {
                await initArticleFtsAudit(this.db);
                await index.probe(false);
            } catch (error) {
                logger.warn("Could not initialize Pages FTS audit evidence.", describeSourceError(error));
            }
        }
        if (this.recoveryAvailable) {
            this.maintenanceAvailable = maintenanceTables.every((name) => names.has(name));
            if (autoInit && !this.maintenanceAvailable) {
                try {
                    await initArticleMaintenance(this.db);
                    this.maintenanceAvailable = true;
                } catch (error) {
                    logger.warn("Could not initialize article maintenance.", describeSourceError(error));
                }
            }
        }
    }

    private async createCacheTable() {
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
    }

    async init() {
        await this.createCacheTable();
        try {
            this.articleIndex = new ArticleIndex(this.db);
            await this.articleIndex.init();
            this.recoveryAvailable = await this.articleIndex.probe();
            this.maintenanceAvailable = this.recoveryAvailable && (await hasArticleMaintenance(this.db));
            if (this.maintenanceAvailable) await this.maintainArticleIndex(5);
        } catch (error) {
            this.articleIndex = undefined;
            logger.warn(
                "Could not initialize article index. Source cache remains available.",
                describeSourceError(error)
            );
        }
        logger.success("init cache table");
    }

    async check(audit = true) {
        await this.db.prepare("SELECT id FROM cache LIMIT 1").get();
        this.articleIndex = new ArticleIndex(this.db);
        this.recoveryAvailable = await this.articleIndex.probe(audit);
        this.maintenanceAvailable = this.recoveryAvailable && (await hasArticleMaintenance(this.db));
    }

    async set(key: string, value: NewsItem[]) {
        const safeItems = filterSafeNewsItemLinks(value);
        if (value.length && !safeItems.length) throw new Error("News cache contains no valid article URLs.");
        const payload = JSON.stringify(safeItems);
        const active = this.activeWrites.get(key);
        if (active?.payload === payload) {
            await active.promise;
            return;
        }
        // Many callers can share one source collection result. Coalesce only identical
        // in-flight writes, not a later observation or an intervening different payload.
        const promise = this.writeSnapshot(key, payload);
        this.activeWrites.set(key, { payload, promise });
        try {
            await promise;
        } finally {
            if (this.activeWrites.get(key)?.promise === promise) this.activeWrites.delete(key);
        }
    }

    private async writeSnapshot(key: string, payload: string) {
        const now = Date.now();
        const cacheSql = `INSERT INTO cache (id,data,updated) VALUES (?,?,?)
            ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated=max(cache.updated+1,excluded.updated)`;
        if (this.recoveryAvailable && this.articleIndex) {
            const id = randomUUID();
            await measureBenchmarkPhase("cache.commit", async () => {
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
                    logger.warn(
                        "Could not journal source cache; retaining cache-only write.",
                        describeSourceError(error)
                    );
                    const result = await this.db.prepare(cacheSql).run(key, payload, now);
                    if (!result.success) throw new Error("News cache write failed.");
                }
            });
            // A committed cache write is not a promise of completed indexing.
            if (this.options.deferMaintenance) {
                // At most one bounded maintenance job per request. Commit the
                // durable journal before returning; waitUntil owns its lifetime.
                this.schedulePagesMaintenance();
            } else await this.maintainArticleIndex(2, id);
        } else {
            const result = await measureBenchmarkPhase("cache.commit", () =>
                this.db.prepare(cacheSql).run(key, payload, now)
            );
            if (!result.success) throw new Error("News cache write failed.");
            // Do not write an unprobed or pre-migration index.
            logger.warn("Article recovery schema unavailable; saved source cache only.");
        }
        logger.success(`set ${key} cache`);
    }

    async schedulePagesBacklogIfNeeded() {
        if (!this.options.deferMaintenance || this.maintenanceScheduled || !this.maintenanceAvailable) return;
        try {
            // The public insight response is already computed. Only check durable
            // work, then attach maintenance to this request's waitUntil.
            const row = (await this.db
                .prepare(
                    `SELECT EXISTS(SELECT 1 FROM article_ingest_pending)
                OR EXISTS(SELECT 1 FROM article_fts_pending)
                OR EXISTS(SELECT 1 FROM article_fts_repair WHERE phase='repairing')
                OR EXISTS(SELECT 1 FROM cache c WHERE NOT EXISTS(
                    SELECT 1 FROM article_ingest_checkpoint p WHERE p.source_id=c.id AND p.observed_at=c.updated AND p.payload=c.data
                )) AS pending`
                )
                .get()) as { pending: number };
            if (row.pending || (await this.articleIndex?.needsFtsAudit())) await this.startPagesMaintenance();
        } catch (error) {
            logger.warn("Could not check Pages article backlog.", describeSourceError(error));
        }
    }

    schedulePagesMaintenance() {
        const pending = this.startPagesMaintenance();
        if (pending) this.options.deferMaintenance!(pending);
    }

    private startPagesMaintenance() {
        if (!this.options.deferMaintenance || this.maintenanceScheduled || !this.maintenanceAvailable) return undefined;
        this.maintenanceScheduled = true;
        return this.maintainArticleIndex(1);
    }

    /** Bounded journal replay. Persist each source snapshot until all articles succeed. */
    async maintainArticleIndex(limit = 5, preferredId = "") {
        if (!this.articleIndex || !this.maintenanceAvailable) return;
        if (!Number.isInteger(limit) || limit < 1 || limit > 20)
            throw new Error("Article replay limit must be between 1 and 20.");
        const trace = getBenchmarkTrace();
        const queuedAt = trace ? monotonicNow() : 0;
        const replay = this.replayTail.then(() => {
            if (trace)
                recordTrace(trace, { phase: "index.queue", durationMs: monotonicNow() - queuedAt, outcome: "success" });
            return measureBenchmarkPhase("index.replay", () =>
                this.runArticleMaintenance(limit, undefined, preferredId)
            );
        });
        // Keep the queue usable after an unexpected failure. A durable journal is the
        // recovery boundary across processes; this lock only serializes this Cache.
        this.replayTail = replay.then(
            () => undefined,
            () => undefined
        );
        await replay;
    }

    /** Independent durable-lease pass. Bounds apply between DB operations;
     * an atomic query already running cannot be preempted. */
    async runArticleMaintenance(limit = 5, signal?: AbortSignal, preferredId = ""): Promise<MaintenanceResult> {
        if (!Number.isInteger(limit) || limit < 1 || limit > 20)
            throw new Error("Article replay limit must be between 1 and 20.");
        const started = monotonicNow();
        const result: MaintenanceResult = {
            status: "unavailable",
            attempted: 0,
            completed: 0,
            failed: 0,
            advanced: 0,
            remaining: null,
            pendingFts: null,
            untrackedCache: null,
            durationMs: 0,
        };
        const finish = () => ({ ...result, durationMs: Math.round(monotonicNow() - started) });
        if (!this.articleIndex || !this.maintenanceAvailable) return finish();
        if (signal?.aborted) return { ...finish(), status: "interrupted" };
        let owner: string | undefined;
        try {
            owner = await acquireMaintenanceLease(this.db);
            if (!owner) {
                result.status = "busy";
                return finish();
            }
            const canContinue = async () =>
                !signal?.aborted &&
                monotonicNow() - started < MAINTENANCE_BUDGET_MS &&
                (await ownsMaintenanceLease(this.db, owner!));
            if (!(await canContinue())) return { ...finish(), status: signal?.aborted ? "interrupted" : "pending" };
            // Recover cache-only fallbacks under the same lease.
            await this.db
                .prepare(
                    `INSERT INTO article_ingest_pending(id,source_id,payload,observed_at)
                SELECT lower(hex(randomblob(16))),c.id,c.data,c.updated FROM cache c
                WHERE ${leaseGuard}
                AND NOT EXISTS(SELECT 1 FROM article_ingest_checkpoint p WHERE p.source_id=c.id AND p.observed_at=c.updated AND p.payload=c.data)
                AND NOT EXISTS(SELECT 1 FROM article_ingest_pending p WHERE p.source_id=c.id AND p.observed_at=c.updated AND p.payload=c.data)
                ORDER BY c.updated,c.id LIMIT ?`
                )
                .run(owner, Date.now(), limit);
            if (!(await canContinue())) return { ...finish(), status: signal?.aborted ? "interrupted" : "pending" };
            const pending = (await this.db
                .prepare(
                    `SELECT p.id,p.source_id,p.payload,p.observed_at,p.attempts,COALESCE(w.next_offset,0) AS next_offset
                FROM article_ingest_pending p LEFT JOIN article_ingest_work w ON w.id=p.id
                WHERE COALESCE(w.next_attempt_at,0)<=?
                ORDER BY CASE WHEN p.id=? THEN 0 ELSE 1 END,p.observed_at,p.id LIMIT ?`
                )
                .all(Date.now(), preferredId, limit)) as Array<{
                id: string;
                source_id: string;
                payload: string;
                observed_at: number;
                attempts: number;
                next_offset: number;
            }>;
            for (const row of pending) {
                if (!(await canContinue())) break;
                result.attempted++;
                try {
                    const items = JSON.parse(row.payload) as NewsItem[];
                    const offset = Number(row.next_offset);
                    if (!Array.isArray(items) || !Number.isSafeInteger(offset) || offset < 0 || offset > items.length)
                        throw new Error("Invalid cached article snapshot.");
                    const next = Math.min(items.length, offset + SNAPSHOT_CHUNK_SIZE);
                    const chunk = items.slice(offset, next);
                    if (
                        chunk.some(
                            (item) =>
                                !item ||
                                typeof item !== "object" ||
                                !["string", "number"].includes(typeof item.id) ||
                                typeof item.title !== "string" ||
                                typeof item.url !== "string"
                        )
                    )
                        throw new Error("Invalid cached article item.");
                    // A crash between upsert and checkpoint repeats a chunk:
                    // canonical identity and observation timestamps are unchanged.
                    await this.articleIndex.upsertSourceItems(row.source_id as SourceID, chunk, row.observed_at, owner);
                    const fence = [owner, Date.now()];
                    if (next === items.length) {
                        const [, removed] = await executeArticleBatch(this.db, [
                            {
                                sql: `INSERT INTO article_ingest_checkpoint(source_id,payload,observed_at)
                                SELECT id,data,updated FROM cache WHERE id=? AND data=? AND updated=? AND ${leaseGuard}
                                ON CONFLICT(source_id) DO UPDATE SET payload=excluded.payload,observed_at=excluded.observed_at`,
                                params: [row.source_id, row.payload, row.observed_at, ...fence],
                            },
                            {
                                sql: `DELETE FROM article_ingest_pending WHERE id=? AND ${leaseGuard} RETURNING id`,
                                params: [row.id, ...fence],
                                rows: true,
                            },
                            {
                                sql: `DELETE FROM article_ingest_work WHERE id=? AND ${leaseGuard}`,
                                params: [row.id, ...fence],
                            },
                        ]);
                        result.completed += removed.length;
                    } else {
                        const [advanced] = await executeArticleBatch(this.db, [
                            {
                                sql: `INSERT INTO article_ingest_work(id,next_offset,next_attempt_at)
                                SELECT ?,?,0 WHERE ${leaseGuard}
                                ON CONFLICT(id) DO UPDATE SET next_offset=excluded.next_offset,next_attempt_at=0 RETURNING id`,
                                params: [row.id, next, ...fence],
                                rows: true,
                            },
                        ]);
                        result.advanced += advanced.length;
                    }
                } catch (error) {
                    logger.warn("Could not replay article snapshot; journal retained.", describeSourceError(error));
                    const now = Date.now();
                    const [failed] = await executeArticleBatch(this.db, [
                        {
                            sql: `UPDATE article_ingest_pending SET attempts=attempts+1 WHERE id=? AND ${leaseGuard} RETURNING id`,
                            params: [row.id, owner, now],
                            rows: true,
                        },
                        {
                            sql: `INSERT INTO article_ingest_work(id,next_offset,next_attempt_at)
                            SELECT ?,?,? WHERE ${leaseGuard}
                            ON CONFLICT(id) DO UPDATE SET next_attempt_at=excluded.next_attempt_at`,
                            params: [row.id, row.next_offset, now + retryDelay(row.attempts + 1), owner, now],
                        },
                    ]);
                    result.failed += failed.length;
                }
            }
            const repair = (await canContinue())
                ? await measureBenchmarkPhase("index.repair", () => this.articleIndex!.continueRepair(2))
                : undefined;
            result.remaining = await readMaintenanceBacklog(this.db);
            result.pendingFts = (await ftsRecoveryStatus(this.db)).pending;
            const health = await this.getArticleIndexHealth();
            result.untrackedCache = "untrackedCache" in health ? (health.untrackedCache ?? null) : null;
            result.status = signal?.aborted
                ? "interrupted"
                : repair?.status === "unavailable"
                  ? "unavailable"
                  : health.status === "ok" && result.remaining.pendingIngest === 0 && result.pendingFts === 0
                    ? "ok"
                    : "pending";
        } catch (error) {
            logger.warn(
                "Article maintenance is unavailable; source cache remains available.",
                describeSourceError(error)
            );
            result.status = "unavailable";
        } finally {
            if (owner) {
                try {
                    await releaseMaintenanceLease(this.db, owner);
                } catch (error) {
                    logger.warn("Article maintenance lease release failed.", describeSourceError(error));
                }
            }
        }
        return finish();
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
        if (this.options.deferMaintenance && !this.recoveryAvailable)
            return { status: "unavailable", mode: "unavailable", items: [] };
        if (this.articleIndex) return this.articleIndex.search(query);
        return new ArticleIndex(this.db).searchLike(query);
    }

    async rebuildArticleSearchIndex() {
        if (!this.articleIndex) return { status: "unavailable" as const, indexed: 0 };
        return this.articleIndex.rebuildSearchIndex();
    }

    async get(key: string): Promise<CacheInfo | undefined> {
        return measureBenchmarkPhase("cache.read", async () => {
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
        });
    }

    async getEntire(keys: string[]): Promise<CacheInfo[]> {
        return measureBenchmarkPhase("cache.read", async () => {
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
        });
    }

    async delete(key: string) {
        return await this.db.prepare("DELETE FROM cache WHERE id = ?").run(key);
    }
}
