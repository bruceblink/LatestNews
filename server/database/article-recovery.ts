import type { Database } from "db0";

import { randomUUID } from "node:crypto";

import { executeArticleBatch } from "./article-atomic-batch";

const PAGE = 50;

export async function initArticleRecovery(db: Database) {
    await db
        .prepare(
            "CREATE TABLE IF NOT EXISTS article_ingest_pending (id TEXT PRIMARY KEY, source_id TEXT NOT NULL, payload TEXT NOT NULL, observed_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0)"
        )
        .run();
    await db
        .prepare(
            "CREATE INDEX IF NOT EXISTS idx_article_ingest_pending_order ON article_ingest_pending (observed_at, id)"
        )
        .run();
    await db
        .prepare(
            "CREATE TABLE IF NOT EXISTS article_ingest_checkpoint (source_id TEXT PRIMARY KEY, payload TEXT NOT NULL, observed_at INTEGER NOT NULL)"
        )
        .run();
    await db.prepare("CREATE TABLE IF NOT EXISTS article_fts_pending (article_key TEXT PRIMARY KEY)").run();
    await db
        .prepare(
            "CREATE TABLE IF NOT EXISTS article_fts_repair (id INTEGER PRIMARY KEY CHECK(id=1), phase TEXT NOT NULL, cursor TEXT NOT NULL, generation TEXT NOT NULL)"
        )
        .run();
    await db.prepare("INSERT OR IGNORE INTO article_fts_repair VALUES (1,'ready','','')").run();
}

export async function probeArticleRecovery(db: Database) {
    const row = (await db
        .prepare(
            "SELECT COUNT(*) AS count FROM sqlite_master WHERE name IN ('articles','article_sources','article_schema_migrations','article_ingest_pending','article_ingest_checkpoint','article_fts_pending','article_fts_repair') AND type='table'"
        )
        .get()) as { count: number };
    return (
        Number(row.count) === 7 &&
        Boolean(
            await db
                .prepare("SELECT id FROM article_schema_migrations WHERE id='n4-l1-article-identities-and-time'")
                .get()
        ) &&
        Boolean(await db.prepare("SELECT id FROM article_fts_repair WHERE id=1").get())
    );
}

export async function ftsIsInconsistent(db: Database) {
    const row = (await db
        .prepare(
            `SELECT EXISTS(
        SELECT 1 FROM articles a LEFT JOIN (
            SELECT article_key, COUNT(*) AS copies, MIN(title) AS title, MIN(canonical_url) AS canonical_url
            FROM article_search GROUP BY article_key
        ) s ON a.article_key=s.article_key
        WHERE s.copies IS NULL OR s.copies<>1 OR s.title IS NOT a.title OR s.canonical_url IS NOT a.canonical_url
    ) OR EXISTS(
        SELECT 1 FROM article_search s LEFT JOIN articles a ON s.article_key=a.article_key WHERE a.article_key IS NULL
    ) AS inconsistent`
        )
        .get()) as { inconsistent: number };
    return Boolean(row.inconsistent);
}

export async function beginFtsRepair(db: Database) {
    await db
        .prepare("UPDATE article_fts_repair SET phase='repairing',cursor='',generation=? WHERE id=1 AND phase='ready'")
        .run(randomUUID());
}

/** All reads use literal fallback until repair and pending writes are drained.
 * Each step repairs a bounded set of keys in one batch. No delete-all window.
 * Cursor/generation guards let another worker win without undoing its progress.
 */
export async function repairFtsPage(db: Database) {
    const state = (await db.prepare("SELECT phase,cursor,generation FROM article_fts_repair WHERE id=1").get()) as {
        phase: string;
        cursor: string;
        generation: string;
    };
    if (state.phase !== "repairing") return { done: true, indexed: 0 };
    const keys = (await db
        .prepare(
            `SELECT article_key FROM (
        SELECT article_key FROM articles WHERE article_key > ?
        UNION SELECT article_key FROM article_search WHERE article_key > ?
    ) ORDER BY article_key LIMIT ${PAGE}`
        )
        .all(state.cursor, state.cursor)) as Array<{ article_key: string }>;
    const guard =
        "EXISTS(SELECT 1 FROM article_fts_repair WHERE id=1 AND phase='repairing' AND generation=? AND cursor=?)";
    if (!keys.length) {
        await db
            .prepare(
                "UPDATE article_fts_repair SET phase='ready',cursor='' WHERE id=1 AND phase='repairing' AND generation=? AND cursor=?"
            )
            .run(state.generation, state.cursor);
        return { done: true, indexed: 0 };
    }
    const json = JSON.stringify(keys.map((row) => row.article_key));
    const keySet = "SELECT value FROM json_each(?)";
    const params = [json, state.generation, state.cursor];
    await executeArticleBatch(db, [
        { sql: `DELETE FROM article_search WHERE article_key IN (${keySet}) AND ${guard}`, params },
        {
            sql: `INSERT INTO article_search(article_key,title,canonical_url) SELECT article_key,title,canonical_url FROM articles WHERE article_key IN (${keySet}) AND ${guard}`,
            params,
        },
        { sql: `DELETE FROM article_fts_pending WHERE article_key IN (${keySet}) AND ${guard}`, params },
        {
            sql: "UPDATE article_fts_repair SET cursor=? WHERE id=1 AND phase='repairing' AND generation=? AND cursor=?",
            params: [keys.at(-1)!.article_key, state.generation, state.cursor],
        },
    ]);
    return { done: false, indexed: keys.length };
}

export async function repairPendingFts(db: Database) {
    // Same transaction selects current queue keys and copies current rows.
    const keys = "SELECT article_key FROM article_fts_pending ORDER BY article_key LIMIT " + PAGE;
    await executeArticleBatch(db, [
        { sql: `DELETE FROM article_search WHERE article_key IN (${keys})` },
        {
            sql: `INSERT INTO article_search(article_key,title,canonical_url) SELECT article_key,title,canonical_url FROM articles WHERE article_key IN (${keys})`,
        },
        { sql: `DELETE FROM article_fts_pending WHERE article_key IN (${keys})` },
    ]);
}

export async function ftsRecoveryStatus(db: Database) {
    const row = (await db
        .prepare(
            "SELECT phase, (SELECT COUNT(*) FROM article_fts_pending) AS pending FROM article_fts_repair WHERE id=1"
        )
        .get()) as { phase: string; pending: number };
    return { phase: row.phase, pending: Number(row.pending) };
}
