import type { Database } from "db0";
import type { NewsItem, SourceID } from "@shared/types";
import type { TopicEvent } from "@shared/news-insights";

import { createHash, randomUUID } from "node:crypto";
import { articleTimestamp } from "@shared/article-time";
import { normalizeNewsItemUrlKey } from "@shared/news-item-schema";
import { safeNewsUrl, safeNewsItemLinks, filterSafeNewsItemLinks } from "@shared/news-url-policy";

import { logger } from "../utils/logger";
import { executeArticleBatch } from "./article-atomic-batch";
import { initArticleEventRegistry } from "./article-event-registry";
import { ARTICLE_SOURCES_SCHEMA, migrateArticleIdentity } from "./article-identity-migration";
import { hasArticleEventAliases, initArticleEventAliases, resolveArticleEventAlias } from "./article-event-aliases";
import {
    resolveTopicEvent,
    initEventApprovals,
    resolveTopicEventsD1,
    provisionalTopicEvent,
} from "./article-event-governance";
import {
    readFtsAudit,
    getFtsTables,
    repairFtsPage,
    auditReadyFts,
    ftsAuditBounds,
    beginFtsRepair,
    FTS_AUDIT_GUARD,
    FTS_READY_GUARD,
    repairPendingFts,
    readFtsReadiness,
    ftsIsInconsistent,
    ftsRecoveryStatus,
    initArticleRecovery,
    probeArticleRecovery,
} from "./article-recovery";

const DEFAULT_SEARCH_LIMIT = 30;
const MAX_SEARCH_LIMIT = 100;

export interface ArticleIndexSearchQuery {
    query: string;
    sourceId?: SourceID;
    since?: number;
    limit?: number;
}

export interface ArticleIndexItem {
    articleKey: string;
    canonicalUrl: string;
    title: string;
    publishedAt?: number | string;
    eventId?: string;
    sourceIds: SourceID[];
    item: NewsItem;
    score?: number;
}

export interface ArticleIndexSearchResult {
    status: "ok" | "unavailable";
    mode: "fts" | "like" | "unavailable";
    items: ArticleIndexItem[];
}

export interface ArticleEventQuery {
    limit: number;
    after?: string;
}

export type ArticleEventResult =
    | { status: "ok"; registeredAt: number; items: ArticleIndexItem[]; nextCursor?: string; canonicalEventId?: string }
    | { status: "not-found" }
    | { status: "unavailable" };

interface ArticleRow {
    article_key: string;
    canonical_url: string;
    title: string;
    published_at: number | string | null;
    event_id: string | null;
    payload: string;
    score?: number;
}

interface ArticleSourceRow {
    article_key: string;
    source_id: SourceID;
}

/** 文章级 SQLite 索引。索引故障由上层捕获，不能阻塞来源缓存。 */
export class ArticleIndex {
    private ftsAvailable = false;
    private ftsAuditAvailable = false;
    // Local negative observation is conservative until an explicit maintenance pass.
    private ftsRejected = false;
    private recoveryAvailable = false;

    constructor(private readonly db: Database) {}

    async init(maintain = true) {
        await this.db
            .prepare(
                `CREATE TABLE IF NOT EXISTS articles (
                    article_key TEXT PRIMARY KEY,
                    canonical_url TEXT NOT NULL UNIQUE,
                    title TEXT NOT NULL,
                    published_at,
                    content_fingerprint TEXT NOT NULL,
                    event_id TEXT,
                    payload TEXT NOT NULL,
                    first_seen_at INTEGER NOT NULL,
                    last_seen_at INTEGER NOT NULL
                )`
            )
            .run();
        await this.db.prepare(`CREATE TABLE IF NOT EXISTS article_sources ${ARTICLE_SOURCES_SCHEMA}`).run();
        await this.db
            .prepare("CREATE INDEX IF NOT EXISTS idx_articles_published_at ON articles (published_at DESC)")
            .run();
        await this.db
            .prepare(
                "CREATE INDEX IF NOT EXISTS idx_article_sources_source ON article_sources (source_id, last_seen_at DESC)"
            )
            .run();

        await migrateArticleIdentity(this.db);
        await initArticleRecovery(this.db);
        this.recoveryAvailable = true;

        try {
            await initArticleEventRegistry(this.db);
            await initArticleEventAliases(this.db);
            await initEventApprovals(this.db);
        } catch (error) {
            logger.warn("Could not initialize article event registry.", error);
        }

        try {
            // Recreating a missing virtual table invalidates any certificate
            // from its former contents, including in additive Pages setup.
            if (
                !(await this.db
                    .prepare("SELECT name FROM sqlite_master WHERE name='article_search' AND type='table'")
                    .get())
            )
                await this.db.prepare("DELETE FROM article_fts_audit WHERE id=1").run();
            await this.db
                .prepare(
                    "CREATE VIRTUAL TABLE IF NOT EXISTS article_search USING fts5(article_key UNINDEXED, title, canonical_url UNINDEXED)"
                )
                .run();
            this.ftsAvailable = true;
            this.ftsAuditAvailable = true;
            this.ftsRejected = false;
            if (!maintain) return;
            await auditReadyFts(this.db, true);
            await this.continueRepair();
        } catch (error) {
            this.ftsAvailable = false;
            this.ftsRejected = true;
            logger.warn("Article FTS5 index is unavailable. Article persistence remains enabled.", error);
        }
    }

    /** Read-only capability detection when INIT_TABLE=false. */
    async probe(audit = true) {
        try {
            this.recoveryAvailable = await probeArticleRecovery(this.db);
            const tables = this.recoveryAvailable ? await getFtsTables(this.db) : { fts: false, audit: false };
            this.ftsAvailable = tables.fts;
            this.ftsAuditAvailable = tables.fts && tables.audit;
            this.ftsRejected = false;
            if (audit && this.ftsAuditAvailable) {
                const state = await ftsRecoveryStatus(this.db);
                // The managed-schema probe can detect damage, but must not
                // create or renew durable proof from a read-only observation.
                if (state.phase === "ready" && !state.pending) this.ftsRejected = await ftsIsInconsistent(this.db);
            }
        } catch {
            this.ftsRejected = true;
            this.ftsAuditAvailable = false;
            this.recoveryAvailable = false;
            this.ftsAvailable = false;
        }
        return this.recoveryAvailable;
    }

    async needsFtsAudit() {
        return (
            this.ftsAuditAvailable && (this.ftsRejected || (await readFtsAudit(this.db, true)).status !== "verified")
        );
    }

    async getRecoveryStatus() {
        try {
            const available = await probeArticleRecovery(this.db);
            if (!available)
                return {
                    status: "unavailable" as const,
                    fts: "unavailable" as const,
                    pendingIngest: null,
                    pendingFts: null,
                    eventRegistry: "unknown" as const,
                };
            const journal = (await this.db.prepare("SELECT COUNT(*) AS count FROM article_ingest_pending").get()) as {
                count: number;
            };
            const registry = (await this.db
                .prepare(
                    "SELECT COUNT(*) AS count FROM sqlite_master WHERE name IN ('news_events','news_event_aliases') AND type='table'"
                )
                .get()) as { count: number };
            const tables = await getFtsTables(this.db);
            const ftsExists = tables.fts;
            const fts = await readFtsReadiness(this.db, tables.fts && tables.audit);
            const ftsAudit = this.ftsRejected ? { status: "failed" as const } : fts.audit;
            const status = !ftsExists
                ? "unavailable"
                : fts.phase !== "ready" || fts.pending || ftsAudit.status !== "verified"
                  ? "degraded"
                  : "ok";
            const eventRegistry = Number(registry.count) === 2 ? "ok" : "unavailable";
            return {
                status:
                    status === "ok" && Number(journal.count) === 0 && eventRegistry === "ok"
                        ? ("ok" as const)
                        : ("degraded" as const),
                fts: status,
                ftsAudit,
                pendingIngest: Number(journal.count),
                pendingFts: fts.pending,
                eventRegistry,
            } as const;
        } catch {
            return {
                status: "unavailable" as const,
                fts: "unavailable" as const,
                pendingIngest: null,
                pendingFts: null,
                eventRegistry: "unknown" as const,
            };
        }
    }

    async upsertSourceItems(sourceId: SourceID, items: NewsItem[], now = Date.now()) {
        if (this.db.connector === "cloudflare-d1") return this.upsertD1SourceItems(sourceId, items, now);

        let inserted = 0;
        let updated = 0;

        for (const item of filterSafeNewsItemLinks(items)) {
            const canonicalUrl = normalizeNewsItemUrlKey(item.url);
            if (!canonicalUrl) continue;
            const rawItemId = String(item.id);
            const contentFingerprint = createContentFingerprint(item, canonicalUrl);
            const candidate = "article-v2-" + createHash("sha256").update(canonicalUrl).digest("hex");
            const fallback = "article-v2-" + randomUUID();
            const publishedAt = articleTimestamp(item.pubDate) ?? articleTimestamp(item.extra?.date);
            // Resolve the actual row by canonical URL inside the same transaction.
            // Raw IDs and fingerprints are metadata, never equivalence proofs.
            const [prior, rows] = await executeArticleBatch(this.db, [
                { sql: "SELECT article_key FROM articles WHERE canonical_url = ?", params: [canonicalUrl], rows: true },
                {
                    sql: `INSERT INTO articles
                          (article_key, canonical_url, title, published_at, content_fingerprint, event_id, payload, first_seen_at, last_seen_at)
                          VALUES (CASE WHEN EXISTS (SELECT 1 FROM articles WHERE article_key = ? AND canonical_url <> ?)
                                  THEN ? ELSE ? END, ?, ?, ?, ?, NULL, ?, ?, ?)
                          ON CONFLICT(canonical_url) DO UPDATE SET
                            title = CASE WHEN excluded.last_seen_at >= articles.last_seen_at THEN excluded.title ELSE articles.title END,
                            published_at = CASE WHEN excluded.last_seen_at >= articles.last_seen_at THEN excluded.published_at ELSE articles.published_at END,
                            content_fingerprint = CASE WHEN excluded.last_seen_at >= articles.last_seen_at THEN excluded.content_fingerprint ELSE articles.content_fingerprint END,
                            payload = CASE WHEN excluded.last_seen_at >= articles.last_seen_at THEN excluded.payload ELSE articles.payload END,
                            first_seen_at = min(articles.first_seen_at, excluded.first_seen_at),
                            last_seen_at = max(articles.last_seen_at, excluded.last_seen_at)
                          RETURNING article_key`,
                    params: [
                        candidate,
                        canonicalUrl,
                        fallback,
                        candidate,
                        canonicalUrl,
                        item.title,
                        publishedAt,
                        contentFingerprint,
                        JSON.stringify(item),
                        now,
                        now,
                    ],
                    rows: true,
                },
                {
                    sql: `INSERT INTO article_sources (article_key, source_id, raw_item_id, first_seen_at, last_seen_at)
                          SELECT article_key, ?, ?, ?, ? FROM articles WHERE canonical_url = ?
                          ON CONFLICT(article_key, source_id) DO UPDATE SET
                            raw_item_id = CASE WHEN excluded.last_seen_at >= article_sources.last_seen_at THEN excluded.raw_item_id ELSE article_sources.raw_item_id END,
                            first_seen_at = min(article_sources.first_seen_at, excluded.first_seen_at),
                            last_seen_at = max(article_sources.last_seen_at, excluded.last_seen_at)`,
                    params: [sourceId, rawItemId, now, now, canonicalUrl],
                },
                ...(this.recoveryAvailable
                    ? [
                          {
                              sql: "INSERT OR IGNORE INTO article_fts_pending(article_key) SELECT article_key FROM articles WHERE canonical_url=?",
                              params: [canonicalUrl],
                          },
                      ]
                    : []),
            ]);
            const articleKey = (rows[0] as { article_key: string } | undefined)?.article_key;
            if (!articleKey) throw new Error("Article upsert returned no identity.");
            if (prior.length) updated += 1;
            else inserted += 1;
            await this.updateFts(articleKey);
        }

        return { inserted, updated };
    }

    /** A normal source snapshot has at most 30 entries. Group its mutations
     * into set-based SQL rather than two remote calls per article. */
    private async upsertD1SourceItems(sourceId: SourceID, items: NewsItem[], now: number) {
        const valid = filterSafeNewsItemLinks(items).flatMap((item) => {
            const url = normalizeNewsItemUrlKey(item.url);
            return url ? [{ item, url }] : [];
        });
        let inserted = 0;
        for (let offset = 0; offset < valid.length; offset += 30) {
            const group = valid.slice(offset, offset + 30);
            const unique = new Map(group.map((row) => [row.url, row.item]));
            const candidates = new Set<string>();
            const payload = JSON.stringify(
                [...unique].map(([url, item]) => {
                    let candidate = "article-v2-" + createHash("sha256").update(url).digest("hex");
                    if (candidates.has(candidate)) candidate = "article-v2-" + randomUUID();
                    candidates.add(candidate);
                    return {
                        url,
                        candidate,
                        fallback: "article-v2-" + randomUUID(),
                        rawId: String(item.id),
                        title: item.title,
                        publishedAt: articleTimestamp(item.pubDate) ?? articleTimestamp(item.extra?.date),
                        fingerprint: createContentFingerprint(item, url),
                        payload: JSON.stringify(item),
                    };
                })
            );
            const incoming = `WITH incoming AS (SELECT
                json_extract(value,'$.url') AS url, json_extract(value,'$.candidate') AS candidate,
                json_extract(value,'$.fallback') AS fallback, json_extract(value,'$.rawId') AS raw_id,
                json_extract(value,'$.title') AS title, json_extract(value,'$.publishedAt') AS published_at,
                json_extract(value,'$.fingerprint') AS fingerprint, json_extract(value,'$.payload') AS payload
                FROM json_each(?))`;
            const keySet =
                "SELECT article_key FROM articles WHERE canonical_url IN (SELECT json_extract(value,'$.url') FROM json_each(?))";
            const [prior, rows] = await executeArticleBatch(this.db, [
                {
                    sql: "SELECT COUNT(*) AS count FROM articles WHERE canonical_url IN (SELECT json_extract(value,'$.url') FROM json_each(?))",
                    params: [payload],
                    rows: true,
                },
                {
                    sql: `${incoming} INSERT INTO articles
                    (article_key, canonical_url, title, published_at, content_fingerprint, event_id, payload, first_seen_at, last_seen_at)
                    SELECT CASE WHEN EXISTS(SELECT 1 FROM articles a WHERE a.article_key=i.candidate AND a.canonical_url<>i.url)
                        THEN i.fallback ELSE i.candidate END,i.url,i.title,i.published_at,i.fingerprint,NULL,i.payload,?,?
                    FROM incoming i WHERE 1
                    ON CONFLICT(canonical_url) DO UPDATE SET
                        title=CASE WHEN excluded.last_seen_at>=articles.last_seen_at THEN excluded.title ELSE articles.title END,
                        published_at=CASE WHEN excluded.last_seen_at>=articles.last_seen_at THEN excluded.published_at ELSE articles.published_at END,
                        content_fingerprint=CASE WHEN excluded.last_seen_at>=articles.last_seen_at THEN excluded.content_fingerprint ELSE articles.content_fingerprint END,
                        payload=CASE WHEN excluded.last_seen_at>=articles.last_seen_at THEN excluded.payload ELSE articles.payload END,
                        first_seen_at=min(articles.first_seen_at,excluded.first_seen_at),
                        last_seen_at=max(articles.last_seen_at,excluded.last_seen_at)
                    RETURNING article_key`,
                    params: [payload, now, now],
                    rows: true,
                },
                {
                    sql: `${incoming} INSERT INTO article_sources(article_key,source_id,raw_item_id,first_seen_at,last_seen_at)
                    SELECT a.article_key,?,i.raw_id,?,? FROM incoming i JOIN articles a ON a.canonical_url=i.url WHERE 1
                    ON CONFLICT(article_key,source_id) DO UPDATE SET
                        raw_item_id=CASE WHEN excluded.last_seen_at>=article_sources.last_seen_at THEN excluded.raw_item_id ELSE article_sources.raw_item_id END,
                        first_seen_at=min(article_sources.first_seen_at,excluded.first_seen_at),
                        last_seen_at=max(article_sources.last_seen_at,excluded.last_seen_at)`,
                    params: [payload, sourceId, now, now],
                },
                ...(this.recoveryAvailable
                    ? [{ sql: `INSERT OR IGNORE INTO article_fts_pending(article_key) ${keySet}`, params: [payload] }]
                    : []),
            ]);
            if (rows.length !== unique.size) throw new Error("Article batch returned incomplete identities.");
            inserted += unique.size - Number((prior[0] as { count: number }).count);
            if (this.ftsAvailable && this.recoveryAvailable) {
                try {
                    await executeArticleBatch(this.db, [
                        {
                            sql: `DELETE FROM article_search WHERE article_key IN (${keySet}) AND ${FTS_READY_GUARD}`,
                            params: [payload],
                        },
                        {
                            sql: `INSERT INTO article_search(article_key,title,canonical_url) SELECT article_key,title,canonical_url FROM articles
                            WHERE article_key IN (${keySet}) AND ${FTS_READY_GUARD}`,
                            params: [payload],
                        },
                        {
                            sql: `DELETE FROM article_fts_pending WHERE article_key IN (${keySet}) AND ${FTS_READY_GUARD}`,
                            params: [payload],
                        },
                    ]);
                } catch (error) {
                    logger.warn("Could not update batched article FTS5 index; pending keys retained.", error);
                }
            }
        }
        return { inserted, updated: valid.length - inserted };
    }

    async resolveEventIds(topicEvents: TopicEvent[]): Promise<TopicEvent[]> {
        if (this.db.connector === "cloudflare-d1") {
            try {
                return await resolveTopicEventsD1(this.db, topicEvents);
            } catch (error) {
                logger.warn("Could not resolve batched article event identities.", error);
                return topicEvents.map((topic) => provisionalTopicEvent(topic, "unavailable"));
            }
        }
        const resolved: TopicEvent[] = [];
        for (const topic of topicEvents) {
            try {
                resolved.push(await resolveTopicEvent(this.db, topic));
            } catch (error) {
                logger.warn("Could not resolve article event identity.", error);
                resolved.push(provisionalTopicEvent(topic, "unavailable"));
            }
        }
        return resolved;
    }

    async getEvent(eventId: string, query: ArticleEventQuery): Promise<ArticleEventResult> {
        try {
            const aliases = await hasArticleEventAliases(this.db);
            const canonicalEventId = aliases ? await resolveArticleEventAlias(this.db, eventId) : eventId;
            const event = (await this.db
                .prepare("SELECT registered_at FROM news_events WHERE event_id = ?")
                .get(canonicalEventId)) as { registered_at: number } | null | undefined;
            if (!event) {
                // A partially initialized registry must not report a legacy membership as missing.
                const membership = await this.db
                    .prepare("SELECT article_key FROM articles WHERE event_id = ? LIMIT 1")
                    .get(eventId);
                return { status: membership ? "unavailable" : "not-found" };
            }
            const limit = Math.max(1, Math.min(MAX_SEARCH_LIMIT, query.limit));
            const members = aliases
                ? "event_id IN (SELECT alias_id FROM news_event_aliases WHERE canonical_id = ? UNION ALL SELECT ?)"
                : "event_id = ?";
            const eventParameters = aliases ? [canonicalEventId, canonicalEventId] : [canonicalEventId];
            const rows = getRows(
                await this.db
                    .prepare(
                        `SELECT article_key, canonical_url, title, published_at, event_id, payload
                         FROM articles WHERE ${members} AND article_key > ?
                         ORDER BY article_key ASC LIMIT ?`
                    )
                    .all(...eventParameters, query.after ?? "", limit + 1)
            ) as ArticleRow[];
            const page = rows.slice(0, limit);
            return {
                status: "ok",
                registeredAt: Number(event.registered_at),
                ...(canonicalEventId !== eventId ? { canonicalEventId } : {}),
                items: await this.mapRows(page),
                ...(rows.length > limit ? { nextCursor: page[page.length - 1].article_key } : {}),
            };
        } catch (error) {
            logger.warn("Could not read article event registry.", error);
            return { status: "unavailable" };
        }
    }

    async rebuildSearchIndex() {
        if (!this.ftsAvailable || !this.recoveryAvailable || !this.ftsAuditAvailable)
            return { status: "unavailable" as const, indexed: 0 };
        try {
            await beginFtsRepair(this.db);
            return await this.continueRepair();
        } catch (error) {
            logger.warn("Could not begin article FTS repair.", error);
            return { status: "unavailable" as const, indexed: 0 };
        }
    }

    async continueRepair(maxPages = 20) {
        if (!this.ftsAvailable || !this.recoveryAvailable) return { status: "unavailable" as const, indexed: 0 };
        let indexed = 0;
        try {
            let state = await ftsRecoveryStatus(this.db);
            if (state.phase === "ready" && state.pending) {
                await repairPendingFts(this.db);
                state = await ftsRecoveryStatus(this.db);
            }
            // Managed legacy schemas remain readable and can drain incremental
            // keys, but only an explicit additive migration enables auditing.
            if (!this.ftsAuditAvailable) return { status: "pending" as const, indexed };

            if (state.phase === "ready" && !state.pending) {
                const proof = await readFtsAudit(this.db, true);
                if (!this.ftsRejected && proof.status === "verified") return { status: "ok" as const, indexed };
                await auditReadyFts(this.db, this.ftsRejected);
                this.ftsRejected = false;
                state = await ftsRecoveryStatus(this.db);
            }

            if (state.phase === "repairing") {
                for (let i = 0; i < maxPages; i++) {
                    const result = await repairFtsPage(this.db);
                    indexed += result.indexed;
                    if (result.done) break;
                }
                state = await ftsRecoveryStatus(this.db);
            }
            if (state.phase === "ready" && state.pending) {
                await repairPendingFts(this.db);
                state = await ftsRecoveryStatus(this.db);
            }
            const ready =
                state.phase === "ready" && !state.pending && (await readFtsAudit(this.db, true)).status === "verified";
            if (ready) this.ftsRejected = false;
            return { status: ready && !this.ftsRejected ? ("ok" as const) : ("pending" as const), indexed };
        } catch (error) {
            this.ftsRejected = true;
            logger.warn("Could not repair article FTS index; durable work remains pending.", error);
            return { status: "unavailable" as const, indexed };
        }
    }

    async search(query: ArticleIndexSearchQuery): Promise<ArticleIndexSearchResult> {
        const text = query.query.trim();
        if (!text) return { status: "ok", mode: "like", items: [] };
        // unicode61 can return a nonempty but incomplete set for Han substrings.
        // Keep the literal path independent of the FTS result count.
        if (
            !this.ftsAvailable ||
            !this.ftsAuditAvailable ||
            this.ftsRejected ||
            /[\p{Script=Han}%_]/u.test(text) ||
            !/[\p{L}\p{N}]/u.test(text)
        ) {
            return this.searchLike(query);
        }

        const limit = Math.min(Math.max(query.limit ?? DEFAULT_SEARCH_LIMIT, 1), MAX_SEARCH_LIMIT);
        const conditions = [
            "article_search MATCH ?",
            FTS_AUDIT_GUARD,
            "NOT EXISTS(SELECT 1 FROM article_fts_pending)",
            "NOT EXISTS(SELECT 1 FROM article_ingest_pending)",
        ];
        const parameters: Array<string | number> = [toFtsQuery(text), ...ftsAuditBounds()];
        if (query.sourceId) {
            conditions.push(
                "EXISTS (SELECT 1 FROM article_sources source WHERE source.article_key = articles.article_key AND source.source_id = ?)"
            );
            parameters.push(query.sourceId);
        }
        if (query.since !== undefined) {
            conditions.push("(typeof(articles.published_at) IN ('integer', 'real') AND articles.published_at >= ?)");
            parameters.push(query.since);
        }
        parameters.push(limit);

        try {
            const rows = await this.db
                .prepare(
                    `SELECT articles.article_key, articles.canonical_url, articles.title, articles.published_at,
                            articles.event_id, articles.payload, bm25(article_search) AS score
                     FROM article_search
                     JOIN articles ON articles.article_key = article_search.article_key AND articles.title=article_search.title AND articles.canonical_url=article_search.canonical_url
                     WHERE ${conditions.join(" AND ")}
                     ORDER BY score ASC, articles.published_at DESC, articles.article_key ASC
                     LIMIT ?`
                )
                .all(...parameters);
            const ftsRows = getRows(rows) as ArticleRow[];
            if (new Set(ftsRows.map((row) => row.article_key)).size !== ftsRows.length) {
                this.ftsRejected = true;
                return this.searchLike(query);
            }
            if (ftsRows.length) return { status: "ok", mode: "fts", items: await this.mapRows(ftsRows) };

            return this.searchLike(query);
        } catch (error) {
            logger.warn("Article FTS5 search is unavailable.", error);
            return this.searchLike(query);
        }
    }

    async searchLike(query: ArticleIndexSearchQuery): Promise<ArticleIndexSearchResult> {
        const text = query.query.trim();
        if (!text) return { status: "ok", mode: "like", items: [] };
        const limit = Math.min(Math.max(query.limit ?? DEFAULT_SEARCH_LIMIT, 1), MAX_SEARCH_LIMIT);
        const terms = [...new Set(text.split(/\s+/u).filter(Boolean))];
        // One JSON binding avoids parameter limits for multi-term D1 searches.
        // instr treats percent, underscore and quotes as literal characters.
        const titleMatches = "NOT EXISTS (SELECT 1 FROM terms WHERE instr(lower(articles.title), lower(term)) = 0)";
        const urlMatches =
            "NOT EXISTS (SELECT 1 FROM terms WHERE instr(lower(articles.canonical_url), lower(term)) = 0)";
        const conditions = [`((${titleMatches}) OR (${urlMatches}))`];
        const parameters: Array<string | number> = [JSON.stringify(terms)];
        if (query.sourceId) {
            conditions.push(
                "EXISTS (SELECT 1 FROM article_sources source WHERE source.article_key = articles.article_key AND source.source_id = ?)"
            );
            parameters.push(query.sourceId);
        }
        if (query.since !== undefined) {
            conditions.push("(typeof(articles.published_at) IN ('integer', 'real') AND articles.published_at >= ?)");
            parameters.push(query.since);
        }
        parameters.push(text, text, limit);
        try {
            const rows = await this.db
                .prepare(
                    `WITH terms AS (SELECT value AS term FROM json_each(?))
                     SELECT articles.article_key, articles.canonical_url, articles.title, articles.published_at,
                            articles.event_id, articles.payload
                     FROM articles
                     WHERE ${conditions.join(" AND ")}
                     ORDER BY CASE
                         WHEN lower(articles.title) = lower(?) THEN 0
                         WHEN instr(lower(articles.title), lower(?)) > 0 THEN 1
                         WHEN ${titleMatches} THEN 2
                         ELSE 3
                     END, articles.published_at DESC, articles.article_key ASC
                     LIMIT ?`
                )
                .all(...parameters);
            return { status: "ok", mode: "like", items: await this.mapRows(getRows(rows) as ArticleRow[]) };
        } catch (error) {
            logger.warn("Article LIKE search is unavailable.", error);
            return { status: "unavailable", mode: "unavailable", items: [] };
        }
    }

    private async updateFts(articleKey: string) {
        if (!this.ftsAvailable) return;
        try {
            await executeArticleBatch(this.db, [
                {
                    sql: `DELETE FROM article_search WHERE article_key = ? AND ${FTS_READY_GUARD}`,
                    params: [articleKey],
                },
                {
                    sql: `INSERT INTO article_search (article_key, title, canonical_url) SELECT article_key, title, canonical_url FROM articles WHERE article_key = ? AND ${FTS_READY_GUARD}`,
                    params: [articleKey],
                },
                {
                    sql: `DELETE FROM article_fts_pending WHERE article_key = ? AND ${FTS_READY_GUARD}`,
                    params: [articleKey],
                },
            ]);
        } catch (error) {
            logger.warn("Could not update article FTS5 index.", error);
        }
    }

    private async mapRows(rows: ArticleRow[]) {
        if (!rows.length) return [];
        const keys = rows.map((row) => row.article_key);
        const placeholders = keys.map(() => "?").join(", ");
        const sourceRows = await this.db
            .prepare(`SELECT article_key, source_id FROM article_sources WHERE article_key IN (${placeholders})`)
            .all(...keys);
        const sourcesByArticle = new Map<string, SourceID[]>();
        for (const row of getRows(sourceRows) as ArticleSourceRow[]) {
            sourcesByArticle.set(row.article_key, [...(sourcesByArticle.get(row.article_key) ?? []), row.source_id]);
        }
        return rows.flatMap((row) => {
            const canonicalUrl = safeNewsUrl(row.canonical_url);
            const item = safeNewsItemLinks(JSON.parse(row.payload) as NewsItem);
            if (!canonicalUrl || !item) return [];
            return [
                {
                    articleKey: row.article_key,
                    canonicalUrl,
                    title: row.title,
                    publishedAt: row.published_at ?? undefined,
                    eventId: row.event_id ?? undefined,
                    sourceIds: [...(sourcesByArticle.get(row.article_key) ?? [])].sort(),
                    item,
                    ...(row.score === undefined ? {} : { score: Number(row.score) }),
                },
            ];
        });
    }
}

function createContentFingerprint(item: NewsItem, canonicalUrl: string) {
    return createHash("sha256")
        .update(
            JSON.stringify({
                title: item.title,
                canonicalUrl,
                publishedAt: item.pubDate ?? item.extra?.date ?? null,
                info: item.extra?.info ?? null,
            })
        )
        .digest("hex");
}

function getRows(value: unknown) {
    if (value && typeof value === "object" && "results" in value) return (value as { results: unknown[] }).results;
    return value as unknown[];
}

function toFtsQuery(value: string) {
    return value
        .split(/\s+/)
        .filter(Boolean)
        .map((term) => `"${term.replaceAll('"', '""')}"`)
        .join(" AND ");
}
