import type { Database } from "db0";

import { articleTimestamp } from "@shared/article-time";

import { executeArticleBatch } from "./article-atomic-batch";

const MIGRATION = "n4-l1-article-identities-and-time";
const SOURCE_INDEX =
    "CREATE INDEX IF NOT EXISTS idx_article_sources_source ON article_sources (source_id, last_seen_at DESC)";

export const ARTICLE_SOURCES_SCHEMA = `(
    article_key TEXT NOT NULL,
    source_id TEXT NOT NULL,
    raw_item_id TEXT NOT NULL,
    first_seen_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    PRIMARY KEY (article_key, source_id)
)`;

/** No persisted article key or event membership is rewritten. A source may reuse
 * its raw ID for a different canonical URL; both historical mappings survive. */
export async function migrateArticleIdentity(db: Database) {
    await db
        .prepare(
            "CREATE TABLE IF NOT EXISTS article_schema_migrations (id TEXT PRIMARY KEY, completed_at INTEGER NOT NULL)"
        )
        .run();
    if (await db.prepare("SELECT id FROM article_schema_migrations WHERE id = ?").get(MIGRATION)) return;

    const table = (await db
        .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'article_sources'")
        .get()) as { sql: string } | undefined;
    // The only previous shipped schema has a UNIQUE(source_id, raw_item_id) clause.
    // One atomic batch; a concurrent initializer can safely repeat the copy.
    if (table && /UNIQUE\s*\(\s*source_id\s*,\s*raw_item_id\s*\)/i.test(table.sql)) {
        await executeArticleBatch(db, [
            { sql: "CREATE TABLE article_sources_n4l1 " + ARTICLE_SOURCES_SCHEMA },
            {
                sql: "INSERT INTO article_sources_n4l1 SELECT article_key, source_id, raw_item_id, first_seen_at, last_seen_at FROM article_sources",
            },
            { sql: "DROP TABLE article_sources" },
            { sql: "ALTER TABLE article_sources_n4l1 RENAME TO article_sources" },
            { sql: SOURCE_INDEX },
        ]);
    }
    // Bounded reads and writes. Re-run after interruption; derive from original
    // payload and compare-and-set so an overlapping new write cannot be replaced.
    let after = "";
    for (;;) {
        const rows = (await db
            .prepare(
                "SELECT article_key, published_at, payload FROM articles WHERE article_key > ? ORDER BY article_key LIMIT 50"
            )
            .all(after)) as Array<{ article_key: string; published_at: string | number | null; payload: string }>;
        if (!rows.length) break;
        await executeArticleBatch(
            db,
            rows.map((row) => {
                let timestamp: number | null = null;
                try {
                    const item = JSON.parse(row.payload);
                    timestamp = articleTimestamp(item?.pubDate) ?? articleTimestamp(item?.extra?.date);
                } catch {
                    // Legacy corrupt payload cannot establish a reliable publication date.
                }
                return {
                    sql: "UPDATE articles SET published_at = ? WHERE article_key = ? AND payload = ? AND published_at IS ?",
                    params: [timestamp, row.article_key, row.payload, row.published_at],
                };
            })
        );
        after = rows[rows.length - 1].article_key;
    }
    await db
        .prepare("INSERT OR IGNORE INTO article_schema_migrations (id, completed_at) VALUES (?, ?)")
        .run(MIGRATION, Date.now());
}
