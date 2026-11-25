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
import { resolveTopicEvent, initEventApprovals, provisionalTopicEvent } from "./article-event-governance";
import { hasArticleEventAliases, initArticleEventAliases, resolveArticleEventAlias } from "./article-event-aliases";
import {
    repairFtsPage,
    beginFtsRepair,
    repairPendingFts,
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
    private ftsVerified = false;
    private recoveryAvailable = false;

    constructor(private readonly db: Database) {}

    async init() {
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
            await this.db
                .prepare(
                    "CREATE VIRTUAL TABLE IF NOT EXISTS article_search USING fts5(article_key UNINDEXED, title, canonical_url UNINDEXED)"
                )
                .run();
            this.ftsAvailable = true;
            this.ftsVerified = !(await ftsIsInconsistent(this.db));
            if (!this.ftsVerified) await beginFtsRepair(this.db);
            await this.continueRepair();
        } catch (error) {
            this.ftsAvailable = false;
            this.ftsVerified = false;
            logger.warn("Article FTS5 index is unavailable. Article persistence remains enabled.", error);
        }
    }

    /** Read-only capability detection when INIT_TABLE=false. */
    async probe() {
        try {
            this.recoveryAvailable = await probeArticleRecovery(this.db);
            this.ftsAvailable =
                this.recoveryAvailable &&
                Boolean(
                    await this.db
                        .prepare("SELECT name FROM sqlite_master WHERE name='article_search' AND type='table'")
                        .get()
                );
            if (this.ftsAvailable) {
                const state = await ftsRecoveryStatus(this.db);
                this.ftsVerified =
                    state.phase === "ready" && state.pending === 0 && !(await ftsIsInconsistent(this.db));
            } else this.ftsVerified = false;
        } catch {
            this.ftsVerified = false;
            this.recoveryAvailable = false;
            this.ftsAvailable = false;
        }
        return this.recoveryAvailable;
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
            const fts = await ftsRecoveryStatus(this.db);
            const ftsExists = Boolean(
                await this.db
                    .prepare("SELECT name FROM sqlite_master WHERE name='article_search' AND type='table'")
                    .get()
            );
            const status = !ftsExists
                ? "unavailable"
                : fts.phase === "repairing" || fts.pending || !this.ftsVerified
                  ? "degraded"
                  : "ok";
            const eventRegistry = Number(registry.count) === 2 ? "ok" : "unavailable";
            return {
                status:
                    status === "ok" && Number(journal.count) === 0 && eventRegistry === "ok"
                        ? ("ok" as const)
                        : ("degraded" as const),
                fts: status,
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

    async resolveEventIds(topicEvents: TopicEvent[]): Promise<TopicEvent[]> {
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
        if (!this.ftsAvailable || !this.recoveryAvailable) return { status: "unavailable" as const, indexed: 0 };
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
            if (!this.ftsVerified) {
                const state = await ftsRecoveryStatus(this.db);
                if (state.phase === "ready" && (await ftsIsInconsistent(this.db))) await beginFtsRepair(this.db);
            }
            for (let i = 0; i < maxPages; i++) {
                const result = await repairFtsPage(this.db);
                indexed += result.indexed;
                if (result.done) break;
            }
            if ((await ftsRecoveryStatus(this.db)).pending) await repairPendingFts(this.db);
            const state = await ftsRecoveryStatus(this.db);
            this.ftsVerified = state.phase === "ready" && state.pending === 0;
            if (this.ftsVerified && indexed > 0 && (await ftsIsInconsistent(this.db))) {
                this.ftsVerified = false;
                await beginFtsRepair(this.db);
            }
            return {
                status: this.ftsVerified ? ("ok" as const) : ("pending" as const),
                indexed,
            };
        } catch (error) {
            this.ftsVerified = false;
            logger.warn("Could not repair article FTS index; durable work remains pending.", error);
            return { status: "unavailable" as const, indexed };
        }
    }

    async search(query: ArticleIndexSearchQuery): Promise<ArticleIndexSearchResult> {
        const text = query.query.trim();
        if (!text) return { status: "ok", mode: this.ftsAvailable ? "fts" : "like", items: [] };
        // unicode61 can return a nonempty but incomplete set for Han substrings.
        // Keep the literal path independent of the FTS result count.
        if (
            !this.ftsAvailable ||
            !this.ftsVerified ||
            /[\p{Script=Han}%_]/u.test(text) ||
            !/[\p{L}\p{N}]/u.test(text)
        ) {
            return this.searchLike(query);
        }

        const limit = Math.min(Math.max(query.limit ?? DEFAULT_SEARCH_LIMIT, 1), MAX_SEARCH_LIMIT);
        const conditions = [
            "article_search MATCH ?",
            "EXISTS(SELECT 1 FROM article_fts_repair WHERE id=1 AND phase='ready')",
            "NOT EXISTS(SELECT 1 FROM article_fts_pending)",
            "NOT EXISTS(SELECT 1 FROM article_ingest_pending)",
        ];
        const parameters: Array<string | number> = [toFtsQuery(text)];
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
                this.ftsVerified = false;
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
                { sql: "DELETE FROM article_search WHERE article_key = ?", params: [articleKey] },
                {
                    sql: "INSERT INTO article_search (article_key, title, canonical_url) SELECT article_key, title, canonical_url FROM articles WHERE article_key = ?",
                    params: [articleKey],
                },
                { sql: "DELETE FROM article_fts_pending WHERE article_key = ?", params: [articleKey] },
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
