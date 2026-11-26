import type { Database } from "db0";

import { randomUUID } from "node:crypto";

import { executeArticleBatch } from "./article-atomic-batch";

const PAGE = 50;
// Local profiling shows transaction boundaries dominate rebuild cost.
// Keep the remote D1 and incremental backlog budgets unchanged.
const SQLITE_BUILD_PAGE = 200;

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

// The expensive full audit is used at startup or the final verification gate,
// never for each bounded rebuild page.
const inconsistent = `EXISTS(
        SELECT 1 FROM articles a LEFT JOIN (
            SELECT article_key, COUNT(*) AS copies, MIN(title) AS title, MIN(canonical_url) AS canonical_url
            FROM article_search GROUP BY article_key
        ) s ON a.article_key=s.article_key
        WHERE s.copies IS NULL OR s.copies<>1 OR s.title IS NOT a.title OR s.canonical_url IS NOT a.canonical_url
    ) OR EXISTS(
        SELECT 1 FROM article_search s LEFT JOIN articles a ON s.article_key=a.article_key WHERE a.article_key IS NULL
    )`;

export async function ftsIsInconsistent(db: Database) {
    const row = (await db.prepare(`SELECT (${inconsistent}) AS inconsistent`).get()) as { inconsistent: number };
    return Boolean(row.inconsistent);
}

const CLEAR_PAGE = 200;
const GENERATION_PREFIX = "fts-v2:";
const BUILD_START = "build-start";
const BUILD_PREFIX = "build:";
const newGeneration = () => GENERATION_PREFIX + randomUUID();
export const FTS_READY_GUARD = "EXISTS(SELECT 1 FROM article_fts_repair WHERE id=1 AND phase='ready')";
const REPAIR_GUARD =
    "EXISTS(SELECT 1 FROM article_fts_repair WHERE id=1 AND phase='repairing' AND generation=? AND cursor=?)";
const STATE_MATCH = "id=1 AND phase='repairing' AND generation=? AND cursor=?";

export async function beginFtsRepair(db: Database) {
    await db
        .prepare(
            "UPDATE article_fts_repair SET phase='repairing',cursor='clear',generation=? WHERE id=1 AND phase='ready'"
        )
        .run(newGeneration());
}

/** Derived FTS rows are cleared in bounded rowid pages, then rebuilt using the
 * indexed article primary key. Every incremental write journals its key, and
 * FTS readers/writers must respect the persisted phase. No source, event or
 * article record is deleted. A legacy interrupted repair restarts at clear.
 */
export async function repairFtsPage(db: Database) {
    const state = (await db.prepare("SELECT phase,cursor,generation FROM article_fts_repair WHERE id=1").get()) as {
        phase: string;
        cursor: string;
        generation: string;
    };
    if (state.phase !== "repairing") return { done: true, indexed: 0 };
    const params = [state.generation, state.cursor];
    if (
        !state.generation.startsWith(GENERATION_PREFIX) ||
        !(
            state.cursor === "clear" ||
            state.cursor === BUILD_START ||
            state.cursor.startsWith(BUILD_PREFIX) ||
            state.cursor === "verify"
        )
    ) {
        await db
            .prepare(`UPDATE article_fts_repair SET cursor='clear',generation=? WHERE ${STATE_MATCH}`)
            .run(newGeneration(), ...params);
        return { done: false, indexed: 0 };
    }
    if (state.cursor === "clear") {
        await executeArticleBatch(db, [
            {
                sql: `DELETE FROM article_search WHERE rowid IN (SELECT rowid FROM article_search ORDER BY rowid LIMIT ${CLEAR_PAGE}) AND ${REPAIR_GUARD}`,
                params,
            },
            {
                sql: `UPDATE article_fts_repair SET cursor=? WHERE ${STATE_MATCH} AND NOT EXISTS(SELECT 1 FROM article_search)`,
                params: [BUILD_START, ...params],
            },
        ]);
        return { done: false, indexed: 0 };
    }
    if (state.cursor === "verify") {
        await repairPendingFts(db, state.generation);
        // Publish ready only when the transaction observes both an empty queue
        // and a complete index. Concurrent new writes after this still journal.
        const [ready] = await executeArticleBatch(db, [
            {
                sql: `UPDATE article_fts_repair SET phase='ready',cursor='' WHERE ${STATE_MATCH}
                AND CASE WHEN EXISTS(SELECT 1 FROM article_fts_pending) THEN 0 ELSE NOT (${inconsistent}) END
                RETURNING id`,
                params,
                rows: true,
            },
            // If the queue is empty but verification failed, restart rather than
            // silently accepting corruption. Guard excludes the successful transition.
            {
                sql: `UPDATE article_fts_repair SET cursor='clear',generation=? WHERE ${STATE_MATCH}
                AND NOT EXISTS(SELECT 1 FROM article_fts_pending)`,
                params: [newGeneration(), ...params],
            },
        ]);
        return { done: ready.length > 0, indexed: 0 };
    }
    const buildPage = db.connector === "sqlite" ? SQLITE_BUILD_PAGE : PAGE;
    const keys = (
        state.cursor === BUILD_START
            ? await db.prepare(`SELECT article_key FROM articles ORDER BY article_key LIMIT ${buildPage}`).all()
            : await db
                  .prepare(
                      `SELECT article_key FROM articles WHERE article_key > ? ORDER BY article_key LIMIT ${buildPage}`
                  )
                  .all(state.cursor.slice(BUILD_PREFIX.length))
    ) as Array<{ article_key: string }>;
    if (!keys.length) {
        await db.prepare(`UPDATE article_fts_repair SET cursor='verify' WHERE ${STATE_MATCH}`).run(...params);
        return { done: false, indexed: 0 };
    }
    const keySet = "SELECT value FROM json_each(?)";
    const keyParams = [JSON.stringify(keys.map((row) => row.article_key)), ...params];
    const statements = await executeArticleBatch(db, [
        {
            sql: `INSERT INTO article_search(article_key,title,canonical_url)
            SELECT article_key,title,canonical_url FROM articles WHERE article_key IN (${keySet}) AND ${REPAIR_GUARD}`,
            params: keyParams,
        },
        {
            sql: `DELETE FROM article_fts_pending WHERE article_key IN (${keySet}) AND ${REPAIR_GUARD}`,
            params: keyParams,
        },
        {
            sql: `UPDATE article_fts_repair SET cursor=? WHERE ${STATE_MATCH} RETURNING id`,
            params: [BUILD_PREFIX + keys.at(-1)!.article_key, ...params],
            rows: true,
        },
    ]);
    return { done: false, indexed: statements[2].length ? keys.length : 0 };
}

export async function repairPendingFts(db: Database, verifyingGeneration?: string) {
    // While rebuilding, only the verifying generation may drain pending keys.
    // Reading the queue, copying the latest rows and clearing keys are atomic.
    const keys = "SELECT article_key FROM article_fts_pending ORDER BY article_key LIMIT " + PAGE;
    const guard = verifyingGeneration
        ? "EXISTS(SELECT 1 FROM article_fts_repair WHERE id=1 AND phase='repairing' AND generation=? AND cursor='verify')"
        : FTS_READY_GUARD;
    const params = verifyingGeneration ? [verifyingGeneration] : [];
    await executeArticleBatch(db, [
        { sql: `DELETE FROM article_search WHERE article_key IN (${keys}) AND ${guard}`, params },
        {
            sql: `INSERT INTO article_search(article_key,title,canonical_url) SELECT article_key,title,canonical_url FROM articles WHERE article_key IN (${keys}) AND ${guard}`,
            params,
        },
        { sql: `DELETE FROM article_fts_pending WHERE article_key IN (${keys}) AND ${guard}`, params },
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
