import type { Database } from "db0";
import type { NewsItem, SourceID } from "@shared/types";
import type { TopicEvent } from "@shared/news-insights";

import { normalizeNewsItemUrlKey } from "@shared/news-item-schema";

import { logger } from "../utils/logger";

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
        await this.db
            .prepare(
                `CREATE TABLE IF NOT EXISTS article_sources (
                    article_key TEXT NOT NULL,
                    source_id TEXT NOT NULL,
                    raw_item_id TEXT NOT NULL,
                    first_seen_at INTEGER NOT NULL,
                    last_seen_at INTEGER NOT NULL,
                    PRIMARY KEY (article_key, source_id),
                    UNIQUE (source_id, raw_item_id)
                )`
            )
            .run();
        await this.db
            .prepare("CREATE INDEX IF NOT EXISTS idx_articles_published_at ON articles (published_at DESC)")
            .run();
        await this.db
            .prepare(
                "CREATE INDEX IF NOT EXISTS idx_article_sources_source ON article_sources (source_id, last_seen_at DESC)"
            )
            .run();

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

        for (const item of items) {
            const canonicalUrl = normalizeNewsItemUrlKey(item.url);
            if (!canonicalUrl) continue;
            const rawItemId = String(item.id);
            const contentFingerprint = createContentFingerprint(item, canonicalUrl);
            const existing = await this.findExistingArticle(sourceId, rawItemId, canonicalUrl, contentFingerprint);
            const articleKey = existing?.article_key ?? createArticleKey(canonicalUrl, sourceId, rawItemId);

            if (existing) {
                await this.db
                    .prepare(
                        `UPDATE articles
                         SET canonical_url = ?, title = ?, published_at = ?, content_fingerprint = ?, payload = ?, last_seen_at = ?
                         WHERE article_key = ?`
                    )
                    .run(
                        canonicalUrl,
                        item.title,
                        item.pubDate ?? item.extra?.date ?? null,
                        contentFingerprint,
                        JSON.stringify(item),
                        now,
                        articleKey
                    );
                updated += 1;
            } else {
                await this.db
                    .prepare(
                        `INSERT INTO articles
                         (article_key, canonical_url, title, published_at, content_fingerprint, event_id, payload, first_seen_at, last_seen_at)
                         VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)`
                    )
                    .run(
                        articleKey,
                        canonicalUrl,
                        item.title,
                        item.pubDate ?? item.extra?.date ?? null,
                        contentFingerprint,
                        JSON.stringify(item),
                        now,
                        now
                    );
                inserted += 1;
            }

            await this.db
                .prepare(
                    `INSERT INTO article_sources
                     (article_key, source_id, raw_item_id, first_seen_at, last_seen_at)
                     VALUES (?, ?, ?, ?, ?)
                     ON CONFLICT (article_key, source_id) DO UPDATE SET
                       raw_item_id = EXCLUDED.raw_item_id,
                       last_seen_at = EXCLUDED.last_seen_at`
                )
                .run(articleKey, sourceId, rawItemId, now, now);
            await this.updateFts(articleKey, item.title, canonicalUrl);
        }

        return { inserted, updated };
    }

    async updateEventIds(topicEvents: TopicEvent[]) {
        let updated = 0;
        for (const topicEvent of topicEvents) {
            for (const item of topicEvent.items) {
                const result = await this.db
                    .prepare("UPDATE articles SET event_id = ? WHERE canonical_url = ?")
                    .run(topicEvent.eventId, normalizeNewsItemUrlKey(item.url));
                updated += (result as { changes?: number }).changes ?? 0;
            }
        }
        return updated;
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
        if (!this.ftsAvailable || !text) {
            return {
                status: this.ftsAvailable ? "ok" : "unavailable",
                mode: this.ftsAvailable ? "fts" : "unavailable",
                items: [],
            };
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
            conditions.push("(articles.published_at IS NULL OR articles.published_at >= ?)");
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
                     ORDER BY score ASC, articles.published_at DESC
                     LIMIT ?`
                )
                .all(...parameters);
            const ftsRows = getRows(rows) as ArticleRow[];
            if (ftsRows.length) return { status: "ok", mode: "fts", items: await this.mapRows(ftsRows) };

            const fallbackConditions = ["(articles.title LIKE ? OR articles.canonical_url LIKE ?)"];
            const fallbackParameters: Array<string | number> = [`%${text}%`, `%${text}%`];
            if (query.sourceId) {
                fallbackConditions.push(
                    "EXISTS (SELECT 1 FROM article_sources source WHERE source.article_key = articles.article_key AND source.source_id = ?)"
                );
                fallbackParameters.push(query.sourceId);
            }
            if (query.since !== undefined) {
                fallbackConditions.push("(articles.published_at IS NULL OR articles.published_at >= ?)");
                fallbackParameters.push(query.since);
            }
            fallbackParameters.push(limit);
            const fallbackRows = await this.db
                .prepare(
                    `SELECT articles.article_key, articles.canonical_url, articles.title, articles.published_at,
                            articles.event_id, articles.payload
                     FROM articles
                     WHERE ${fallbackConditions.join(" AND ")}
                     ORDER BY articles.published_at DESC
                     LIMIT ?`
                )
                .all(...fallbackParameters);
            return { status: "ok", mode: "like", items: await this.mapRows(getRows(fallbackRows) as ArticleRow[]) };
        } catch (error) {
            this.ftsAvailable = false;
            logger.warn("Article FTS5 search is unavailable.", error);
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

    private async findExistingArticle(
        sourceId: SourceID,
        rawItemId: string,
        canonicalUrl: string,
        contentFingerprint: string
    ) {
        const byUrl = await this.db
            .prepare("SELECT article_key FROM articles WHERE canonical_url = ? LIMIT 1")
            .get(canonicalUrl);
        if (byUrl) return byUrl as { article_key: string };

        const bySourceId = await this.db
            .prepare(
                `SELECT article_key FROM article_sources
                 WHERE source_id = ? AND raw_item_id = ? LIMIT 1`
            )
            .get(sourceId, rawItemId);
        if (bySourceId) return bySourceId as { article_key: string };

        const byFingerprint = await this.db
            .prepare("SELECT article_key FROM articles WHERE content_fingerprint = ? LIMIT 1")
            .get(contentFingerprint);
        return (byFingerprint as { article_key: string } | undefined) ?? undefined;
    }

    private async updateFts(articleKey: string, title: string, canonicalUrl: string) {
        if (!this.ftsAvailable) return;
        try {
            await this.db.prepare("DELETE FROM article_search WHERE article_key = ?").run(articleKey);
            await this.db
                .prepare("INSERT INTO article_search (article_key, title, canonical_url) VALUES (?, ?, ?)")
                .run(articleKey, title, canonicalUrl);
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
        return rows.map((row) => ({
            articleKey: row.article_key,
            canonicalUrl: row.canonical_url,
            title: row.title,
            publishedAt: row.published_at ?? undefined,
            eventId: row.event_id ?? undefined,
            sourceIds: [...(sourcesByArticle.get(row.article_key) ?? [])].sort(),
            item: JSON.parse(row.payload) as NewsItem,
            ...(row.score === undefined ? {} : { score: Number(row.score) }),
        }));
    }
}

function createContentFingerprint(item: NewsItem, canonicalUrl: string) {
    return hashString(
        JSON.stringify({
            title: item.title,
            canonicalUrl,
            publishedAt: item.pubDate ?? item.extra?.date ?? null,
            info: item.extra?.info ?? null,
        })
    );
}

function createArticleKey(canonicalUrl: string, sourceId: SourceID, rawItemId: string) {
    return `article-${hashString(canonicalUrl || `${sourceId}:${rawItemId}`)}`;
}

function hashString(value: string) {
    let hash = 0;
    for (let index = 0; index < value.length; index += 1) hash = (hash * 31 + value.charCodeAt(index)) % 4294967296;
    return hash.toString(36);
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
