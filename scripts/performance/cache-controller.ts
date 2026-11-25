import { createRequire } from "node:module";

interface SqliteStatement {
    run(...values: Array<number | string>): { changes: number };
    get(...values: Array<number | string>): unknown;
}

interface SqliteDatabase {
    prepare(query: string): SqliteStatement;
    transaction<T>(run: () => T): { immediate(): T };
    close(): void;
}

interface SqliteDatabaseConstructor {
    new (path: string): SqliteDatabase;
}

const BetterSqlite3 = createRequire(import.meta.url)("better-sqlite3") as SqliteDatabaseConstructor;

/** Limit benchmark cache mutations to the supplied isolated SQLite database. */
export function createPerformanceCacheController(databasePath: string) {
    const database = new BetterSqlite3(databasePath);
    let closed = false;

    function validateSourceIds(sourceIds: string[]) {
        if (
            closed ||
            sourceIds.length === 0 ||
            sourceIds.some((sourceId) => !sourceId.trim()) ||
            new Set(sourceIds).size !== sourceIds.length
        ) {
            throw new Error("Performance cache operations require open database state and unique source IDs.");
        }
    }

    return {
        hasAll(sourceIds: string[]) {
            validateSourceIds(sourceIds);
            const placeholders = sourceIds.map(() => "?").join(", ");
            const row = database
                .prepare(`SELECT count(*) AS count FROM cache WHERE id IN (${placeholders})`)
                .get(...sourceIds) as { count: number };
            return row.count === sourceIds.length;
        },
        isSettled(sourceIds: string[]) {
            validateSourceIds(sourceIds);
            const placeholders = sourceIds.map(() => "?").join(", ");
            const row = database
                .prepare(
                    `SELECT
                (SELECT COUNT(*) FROM cache c JOIN article_ingest_checkpoint p
                    ON p.source_id=c.id AND p.observed_at=c.updated AND p.payload=c.data
                    WHERE c.id IN (${placeholders})) AS tracked,
                (SELECT COUNT(*) FROM article_ingest_pending) AS pending,
                (SELECT COUNT(*) FROM article_fts_pending) AS fts,
                (SELECT phase FROM article_fts_repair WHERE id=1) AS phase`
                )
                .get(...sourceIds) as {
                tracked: number;
                pending: number;
                fts: number;
                phase: string;
            };
            return row.tracked === sourceIds.length && row.pending === 0 && row.fts === 0 && row.phase === "ready";
        },
        clear(sourceIds: string[]) {
            validateSourceIds(sourceIds);
            const placeholders = sourceIds.map(() => "?").join(", ");
            database.prepare(`DELETE FROM cache WHERE id IN (${placeholders})`).run(...sourceIds);
        },
        setUpdatedAt(sourceIds: string[], updatedAt: number) {
            validateSourceIds(sourceIds);
            if (!Number.isSafeInteger(updatedAt) || updatedAt < 0) {
                throw new Error("Performance cache timestamps must be non-negative safe integers.");
            }

            const placeholders = sourceIds.map(() => "?").join(", ");
            database
                .transaction(() => {
                    // This is synthetic cache aging, not a new observation. Keep matching
                    // checkpoints aligned so the benchmark does not invent ingest work.
                    database
                        .prepare(
                            `UPDATE article_ingest_checkpoint SET observed_at=?
                WHERE source_id IN (${placeholders}) AND EXISTS(
                    SELECT 1 FROM cache c WHERE c.id=source_id AND c.updated=observed_at AND c.data=payload
                )`
                        )
                        .run(updatedAt, ...sourceIds);
                    const result = database
                        .prepare(`UPDATE cache SET updated = ? WHERE id IN (${placeholders})`)
                        .run(updatedAt, ...sourceIds);
                    if (result.changes !== sourceIds.length) {
                        throw new Error(`Expected ${sourceIds.length} cached sources to age, found ${result.changes}.`);
                    }
                })
                .immediate();
        },
        close() {
            if (closed) return;
            closed = true;
            database.close();
        },
    };
}

export type PerformanceCacheController = ReturnType<typeof createPerformanceCacheController>;
