import type { Database } from "db0";

/**
 * The registry is additive. Keep article membership as the source of truth.
 * Triggers register newly assigned IDs in the same SQLite statement as membership.
 */
export async function initArticleEventRegistry(db: Database) {
    await db
        .prepare(
            `CREATE TABLE IF NOT EXISTS news_events (
            event_id TEXT NOT NULL PRIMARY KEY,
            registered_at INTEGER NOT NULL
        )`
        )
        .run();
    await db.prepare("CREATE INDEX IF NOT EXISTS idx_articles_event_members ON articles (event_id, article_key)").run();
    for (const [name, operation] of [
        ["trg_articles_event_insert", "INSERT"],
        ["trg_articles_event_update", "UPDATE OF event_id"],
    ] as const) {
        await db
            .prepare(
                `CREATE TRIGGER IF NOT EXISTS ${name}
             AFTER ${operation} ON articles
             WHEN NEW.event_id IS NOT NULL
             BEGIN
                 INSERT OR IGNORE INTO news_events (event_id, registered_at)
                 VALUES (NEW.event_id, unixepoch() * 1000);
             END`
            )
            .run();
    }
    // Register legacy memberships without rewriting their event IDs.
    // registered_at records registry insertion, not the date the news happened.
    await db
        .prepare(
            `INSERT OR IGNORE INTO news_events (event_id, registered_at)
         SELECT DISTINCT event_id, unixepoch() * 1000
         FROM articles WHERE event_id IS NOT NULL`
        )
        .run();
}
