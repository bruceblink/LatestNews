import type { Database } from "db0";
import type { NewsItem, SourceID } from "@shared/types";
import type { TopicEvent } from "@shared/news-insights";

import { createHash, randomUUID } from "node:crypto";
import { articleTimestamp } from "@shared/article-time";
import { normalizeNewsItemUrlKey } from "@shared/news-item-schema";
import { safeNewsUrl, safeNewsItemLinks, filterSafeNewsItemLinks } from "@shared/news-url-policy";

import { logger } from "../utils/logger";
import { executeArticleBatch } from "./article-atomic-batch";
import { reconcileArticleEventId } from "./article-event-identity";
import { initArticleEventRegistry } from "./article-event-registry";
import { ARTICLE_SOURCES_SCHEMA, migrateArticleIdentity } from "./article-identity-migration";
import { hasArticleEventAliases, initArticleEventAliases, resolveArticleEventAlias } from "./article-event-aliases";

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

        try {
            await initArticleEventRegistry(this.db);
            await initArticleEventAliases(this.db);
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
            await this.rebuildIfOutOfDate();
        } catch (error) {
            this.ftsAvailable = false;
            logger.warn("Article FTS5 index is unavailable. Article persistence remains enabled.", error);
        }
    }

    async upsertSourceItems(sourceId: SourceID, items: NewsItem[]) {
        const now = Date.now();
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
                            title = excluded.title, published_at = excluded.published_at,
                            content_fingerprint = excluded.content_fingerprint, payload = excluded.payload,
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
                            raw_item_id = excluded.raw_item_id, last_seen_at = max(article_sources.last_seen_at, excluded.last_seen_at)`,
                    params: [sourceId, rawItemId, now, now, canonicalUrl],
                },
            ]);
            const articleKey = (rows[0] as { article_key: string } | undefined)?.article_key;
            if (!articleKey) throw new Error("Article upsert returned no identity.");
            if (prior.length) updated += 1;
            else inserted += 1;
            await this.updateFts(articleKey);
        }

        return { inserted, updated };
    }

    async reconcileEventIds(topicEvents: TopicEvent[]): Promise<TopicEvent[]> {
        const reconciled: TopicEvent[] = [];
        for (const topicEvent of topicEvents) {
            try {
                const eventId = await reconcileArticleEventId(
                    this.db,
                    filterSafeNewsItemLinks(topicEvent.items).map((item) => normalizeNewsItemUrlKey(item.url)),
                    topicEvent.eventId
                );
                reconciled.push({ ...topicEvent, eventId });
            } catch (error) {
                // A failed index must not fail insights or discard other resolved identities.
                logger.warn("Could not reconcile article event ID.", error);
                reconciled.push(topicEvent);
            }
        }
        return reconciled;
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
        if (!this.ftsAvailable) return { status: "unavailable" as const, indexed: 0 };

        try {
            await this.db.prepare("DELETE FROM article_search").run();
            const rows = await this.db
                .prepare("SELECT article_key, title, canonical_url FROM articles ORDER BY last_seen_at ASC")
                .all();
            const articles = getRows(rows) as Array<{ article_key: string; title: string; canonical_url: string }>;
            for (const article of articles) {
                await this.db
                    .prepare("INSERT INTO article_search (article_key, title, canonical_url) VALUES (?, ?, ?)")
                    .run(article.article_key, article.title, article.canonical_url);
            }
            return { status: "ok" as const, indexed: articles.length };
        } catch (error) {
            this.ftsAvailable = false;
            logger.warn("Could not rebuild article FTS5 index.", error);
            return { status: "unavailable" as const, indexed: 0 };
        }
    }

    async search(query: ArticleIndexSearchQuery): Promise<ArticleIndexSearchResult> {
        const text = query.query.trim();
        if (!text) return { status: "ok", mode: this.ftsAvailable ? "fts" : "like", items: [] };
        // unicode61 can return a nonempty but incomplete set for Han substrings.
        // Keep the literal path independent of the FTS result count.
        if (!this.ftsAvailable || /[\p{Script=Han}%_]/u.test(text) || !/[\p{L}\p{N}]/u.test(text)) {
            return this.searchLike(query);
        }

        const limit = Math.min(Math.max(query.limit ?? DEFAULT_SEARCH_LIMIT, 1), MAX_SEARCH_LIMIT);
        const conditions = ["article_search MATCH ?"];
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
                     JOIN articles ON articles.article_key = article_search.article_key
                     WHERE ${conditions.join(" AND ")}
                     ORDER BY score ASC, articles.published_at DESC, articles.article_key ASC
                     LIMIT ?`
                )
                .all(...parameters);
            const ftsRows = getRows(rows) as ArticleRow[];
            if (ftsRows.length) return { status: "ok", mode: "fts", items: await this.mapRows(ftsRows) };

            return this.searchLike(query);
        } catch (error) {
            this.ftsAvailable = false;
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

    private async rebuildIfOutOfDate() {
        const articleCount = await this.db.prepare("SELECT count(*) AS count FROM articles").get();
        const searchCount = await this.db.prepare("SELECT count(*) AS count FROM article_search").get();
        const articles = Number((articleCount as { count: number }).count);
        const indexed = Number((searchCount as { count: number }).count);
        if (articles !== indexed) await this.rebuildSearchIndex();
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
            ]);
        } catch (error) {
            this.ftsAvailable = false;
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
